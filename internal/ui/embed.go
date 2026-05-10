package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// assetExts is the set of path extensions that look like static assets
// (bundles, images, fonts). When a request path has one of these but
// the file doesn't actually exist in dist/, the handler 404s instead
// of falling through to the SPA index.
//
// Without this guard a stale browser-cached index.html (referencing
// bundle filenames from a previous build) would request the missing
// bundle, the server would serve index.html with Content-Type
// text/html, and the browser would try to parse HTML as JavaScript —
// the page silently breaks and the user has to hard-refresh.
var assetExts = map[string]struct{}{
	".js":          {},
	".css":         {},
	".map":         {},
	".svg":         {},
	".png":         {},
	".jpg":         {},
	".jpeg":        {},
	".gif":         {},
	".ico":         {},
	".woff":        {},
	".woff2":       {},
	".ttf":         {},
	".otf":         {},
	".webp":        {},
	".webmanifest": {},
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
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(r.URL.Path, "/")
		_, statErr := fs.Stat(sub, clean)
		if statErr != nil {
			// Path doesn't exist in dist/. Asset-shaped requests get a
			// clean 404; everything else falls through to index.html
			// (SPA client-side routing).
			ext := strings.ToLower(path.Ext(clean))
			if _, isAsset := assetExts[ext]; isAsset {
				http.NotFound(w, r)
				return
			}
			r.URL.Path = "/"
		}
		// Defeat HTML caching so the bundle filenames in the served
		// index.html always reflect the current build. The hashed
		// bundle assets themselves are immutable per content hash, so
		// FileServer's default headers stay; only HTML responses get
		// the no-cache override.
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		}
		fileServer.ServeHTTP(w, r)
	}), nil
}
