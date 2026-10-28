package ui

import (
	"compress/gzip"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
)

//go:embed all:dist
var distFS embed.FS

// isAssetExt reports whether ext is a path extension that looks like a static asset
// (bundles, images, fonts). When a request path has one of these but
// the file doesn't actually exist in dist/, the handler 404s instead
// of falling through to the SPA index.
//
// Without this guard a stale browser-cached index.html (referencing
// bundle filenames from a previous build) would request the missing
// bundle, the server would serve index.html with Content-Type
// text/html, and the browser would try to parse HTML as JavaScript —
// the page silently breaks and the user has to hard-refresh.
func isAssetExt(ext string) bool {
	switch ext {
	case ".js", ".css", ".map", ".svg", ".png", ".jpg", ".jpeg", ".gif",
		".ico", ".woff", ".woff2", ".ttf", ".otf", ".webp", ".webmanifest":
		return true
	}
	return false
}

// isCompressibleExt reports whether ext is a path extension worth gzip pre-
// compression: text-shaped bundles whose payload shrinks substantially
// under DEFLATE. Already-compressed binary types (images, fonts) are
// intentionally absent — re-compressing them just burns CPU and usually
// grows the body a few bytes.
//
// PSR-F5 / #103: the embedded SPA assets were served with no
// Content-Encoding, so every visit shipped the full ~13 MiB vendors.js
// uncompressed over the wire. Browsers always send
// `Accept-Encoding: gzip`; serving gzip cuts the dominant bundle to
// roughly a quarter of its size with no build-step change.
func isCompressibleExt(ext string) bool {
	switch ext {
	case ".js", ".css", ".map", ".svg", ".html", ".json", ".webmanifest", ".txt":
		return true
	}
	return false
}

// minCompressSize is the smallest response body worth compressing. Below
// this the gzip framing overhead (~20 bytes) plus the per-request CPU
// cost outweighs the byte savings, and very small files often grow.
const minCompressSize = 1024

// gzipWriterPool recycles *gzip.Writer instances so a busy server does
// not allocate (and GC) one writer + its DEFLATE state per request.
//
//nolint:gochecknoglobals // a sync.Pool only amortises allocations when shared process-wide.
var gzipWriterPool = sync.Pool{
	New: func() any {
		// BestSpeed keeps per-request CPU low; the embedded bundles are
		// already minified so the extra ratio from higher levels is
		// marginal. The level is fixed so Reset() never re-inits.
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

// Handler returns an http.Handler that serves the embedded SPA.
//
//   - Asset-shaped paths (.js/.css/etc.) that don't exist 404 cleanly
//     so a stale cached index.html doesn't get served as a script.
//   - Other paths fall through to /index.html so client-side routing
//     works (the SPA owns route resolution post-mount).
//   - index.html is served with Cache-Control: no-cache, must-revalidate
//     so that a rebuild's index.html (with new hashed bundle filenames)
//     is picked up immediately on the next visit. Hashed bundle assets
//     keep http.FileServer's default cache behaviour — they're
//     content-addressable, so an aggressive cache is correct.
//   - Compressible text bundles (.js/.css/.map/.svg/.html/...) at least
//     1 KiB are gzip-compressed on the fly when the client sends
//     `Accept-Encoding: gzip`; the response then carries
//     `Content-Encoding: gzip` + `Vary: Accept-Encoding`. The gzip
//     writers are pooled so a hot path doesn't churn allocations.
//   - PERF-2026-05-13-02 / GAP-022 / PSR-F5 (#103): the embed FS is
//     immutable post-build, so the per-request `fs.Stat` lookups are
//     cached in a `sync.Map`. POSITIVE results only — 404s are not
//     cached to keep attacker-shaped URLs from growing the map
//     unboundedly.
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}
	return handlerFS(sub)
}

// handlerFS is the implementation factory of Handler split out so tests
// can inject an instrumented fs.FS to observe the Stat-cache contract.
// The cache (sync.Map of cleaned-path -> fs.FileInfo) is closed over
// by the returned handler so each Handler/handlerFS construction gets
// its own cache (and the cache is GC'd when the handler is dropped).
func handlerFS(sub fs.FS) (http.Handler, error) {
	fileServer := http.FileServer(http.FS(sub))
	// statCache holds POSITIVE Stat results only. The embed.FS is
	// immutable post-build (compiled in at link time), so a successful
	// FileInfo is valid forever. We never cache a miss — a missing
	// entry must re-Stat so a future positive result is not shadowed
	// by a stale negative, and (more importantly for security) so an
	// attacker cannot grow the map without bound by requesting random
	// `*.js` / `*.css` filenames.
	var statCache sync.Map // key: string (cleaned path) → value: fs.FileInfo
	statCached := func(name string) (fs.FileInfo, error) {
		if v, ok := statCache.Load(name); ok {
			if info, isInfo := v.(fs.FileInfo); isInfo {
				return info, nil
			}
		}
		info, err := fs.Stat(sub, name)
		if err != nil {
			return nil, err
		}
		// First-write-wins is fine: two concurrent callers may both
		// Stat the same path on a cold miss; the second's LoadOrStore
		// keeps the first's *fs.FileInfo. The FileInfo is read-only
		// for all callers (we only inspect Size()), so this is safe.
		actual, _ := statCache.LoadOrStore(name, info)
		if cached, isInfo := actual.(fs.FileInfo); isInfo {
			return cached, nil
		}
		return info, nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(r.URL.Path, "/")

		// Resolve the on-disk target and its size in one Stat (cached
		// on subsequent hits). For SPA fallback paths the target is
		// index.html.
		info, statErr := statCached(clean)
		if statErr != nil {
			ext := strings.ToLower(path.Ext(clean))
			if isAssetExt(ext) {
				http.NotFound(w, r)
				return
			}
			r.URL.Path = "/"
			info, _ = statCached("index.html")
		}

		// Defeat HTML caching so the bundle filenames in the served
		// index.html always reflect the current build. Only HTML
		// responses get the no-cache override; hashed bundles keep
		// FileServer's default headers.
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		}

		// Decide compression up front: we know the served file's
		// extension and exact size, so no deferred Content-Type sniffing
		// is needed.
		if gw := newGzipWriter(w, r, servedExt(r.URL.Path), info); gw != nil {
			defer gw.close()
			w = gw
		}
		fileServer.ServeHTTP(w, r)
	}), nil
}

// servedExt returns the lower-cased extension that determines the
// compressibility class of the response for this (possibly SPA-rewritten)
// request path. A path of "/" or any directory-shaped path resolves to
// index.html, i.e. ".html".
func servedExt(p string) string {
	if p == "/" || strings.HasSuffix(p, "/") {
		return ".html"
	}
	return strings.ToLower(path.Ext(p))
}

// newGzipWriter returns a gzipResponseWriter when the response for this
// request should be gzip-compressed, or nil otherwise. When it returns
// non-nil the caller MUST call close() on it (the Handler does so via
// defer). When it returns nil it has still set Vary: Accept-Encoding iff
// the path is compressible (so shared caches key correctly even on the
// non-gzip branch — e.g. a tiny compressible file, or a client that did
// not advertise gzip).
func newGzipWriter(w http.ResponseWriter, r *http.Request, ext string, info fs.FileInfo) *gzipResponseWriter {
	if !isCompressibleExt(ext) {
		return nil
	}
	// Any response on a compressible path is encoding-dependent.
	w.Header().Add("Vary", "Accept-Encoding")
	if info != nil && info.Size() < minCompressSize {
		return nil
	}
	if !acceptsGzip(r) {
		return nil
	}
	if r.Method == http.MethodHead {
		// FileServer writes no body for HEAD; nothing to compress, and
		// we must not claim a Content-Encoding we won't honour.
		return nil
	}
	gz, ok := gzipWriterPool.Get().(*gzip.Writer)
	if !ok {
		gz, _ = gzip.NewWriterLevel(w, gzip.BestSpeed)
	}
	gz.Reset(w)
	w.Header().Set("Content-Encoding", "gzip")
	// The compressed length is unknown ahead of time; drop FileServer's
	// (uncompressed) Content-Length so net/http uses chunked transfer.
	// FileServer sets Content-Length lazily on its first Write, so we
	// also strip it again at flush time — see gzipResponseWriter.flush.
	w.Header().Del("Content-Length")
	return &gzipResponseWriter{ResponseWriter: w, gz: gz}
}

// acceptsGzip reports whether the client's Accept-Encoding header lists
// gzip (or "*") with a non-zero quality value. "gzip;q=0" opts out.
func acceptsGzip(r *http.Request) bool {
	for part := range strings.SplitSeq(r.Header.Get("Accept-Encoding"), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		token := part
		q := 1.0
		if i := strings.IndexByte(part, ';'); i >= 0 {
			token = strings.TrimSpace(part[:i])
			if j := strings.Index(strings.ToLower(part[i+1:]), "q="); j >= 0 {
				if v, err := strconv.ParseFloat(strings.TrimSpace(part[i+1+j+2:]), 64); err == nil {
					q = v
				}
			}
		}
		token = strings.ToLower(token)
		if (token == "gzip" || token == "*") && q > 0 {
			return true
		}
	}
	return false
}

// gzipResponseWriter wraps an http.ResponseWriter and gzip-encodes the
// body. The compression decision is already made by newGzipWriter, so
// this type only has to (a) keep FileServer from re-adding a stale
// Content-Length once it starts writing and (b) flush + return the
// pooled gzip.Writer when done.
type gzipResponseWriter struct {
	http.ResponseWriter

	gz *gzip.Writer

	status      int  // status sent (or to send); 0 until known
	wroteHeader bool // WriteHeader has flushed the status line
	wroteBody   bool // at least one Write call happened
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	if g.wroteHeader {
		return
	}
	g.wroteHeader = true
	g.status = status
	// On a 304 / 204 (or any error code) there is no body, so the
	// gzip Content-Encoding header is meaningless and must not be
	// honoured by emitting a trailer. Strip it so the response is
	// well-formed.
	if status == http.StatusNotModified || status == http.StatusNoContent || status >= 400 {
		g.Header().Del("Content-Encoding")
		g.Header().Del("Vary")
	}
	// FileServer calls WriteHeader(200) with a Content-Length it just
	// computed from the (uncompressed) file size; that length is wrong
	// for the gzip stream we're about to emit.
	g.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if len(b) == 0 {
		return 0, nil
	}
	g.wroteBody = true
	return g.gz.Write(b)
}

// close finalises the gzip stream (writing the trailer when a body was
// actually emitted) and returns the pooled writer. Safe to call exactly
// once.
func (g *gzipResponseWriter) close() {
	if g.gz == nil {
		return
	}
	if !g.wroteHeader {
		// Nothing was written at all. Strip the encoding hint and flush
		// a bare 200.
		g.Header().Del("Content-Encoding")
		g.WriteHeader(http.StatusOK)
	}
	if g.wroteBody {
		_ = g.gz.Close() // writes the gzip CRC/length trailer
	}
	g.gz.Reset(io.Discard) // drop the ResponseWriter reference
	gzipWriterPool.Put(g.gz)
	g.gz = nil
}
