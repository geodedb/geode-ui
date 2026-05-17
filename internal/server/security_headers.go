package server

import (
	"expvar"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Security-headers wrappers complement the genapi-emitted httpx.WrapHandler
// pipeline (gen/pkg/httpx/server.go:110-145), which sets HSTS,
// X-Frame-Options, X-Content-Type-Options, and Referrer-Policy globally
// but does not yet emit Content-Security-Policy, Permissions-Policy, or
// Cross-Origin-Opener-Policy. The structural fix belongs in genapi (file
// a follow-up issue); this file is the geode-ui-side interim wrapper.
//
// Two wrappers are exposed:
//
//   - WithSPASecurityHeaders adds CSP and COOP to HTML responses only.
//     Apply it around the SPA handler — APIs serving JSON should not
//     receive CSP because the directive bloats every response and adds
//     no protection on a non-renderable body.
//
//   - WithPermissionsPolicy adds Permissions-Policy globally. The
//     directive is a tiny, harmless allow-list and applies to every
//     surface a browser may reach, so applying it at the outermost layer
//     keeps the policy uniform across SPA and API.

// CSPDirective is the Content-Security-Policy emitted on SPA HTML
// responses. The policy is Monaco-editor compatible:
//
//   - 'wasm-unsafe-eval' on script-src is required by Monaco's WASM
//     tokenizer. Modern monaco-editor (>=0.55) does not need
//     'unsafe-eval'.
//
//   - 'unsafe-inline' on style-src is required by styled-components,
//     which injects per-render <style> tags at runtime. A future
//     follow-up could replace this with nonces; that is out of scope for
//     SEC-F4 (#60).
//
//   - worker-src 'self' blob: covers Monaco's web-worker bundle, which
//     is loaded as a Blob URL.
//
//   - connect-src 'self' wss: allows the WebSocket query stream
//     (cmd/server/main.go wires /ws/query).
//
//   - img-src/font-src 'self' data: covers inline data: URIs the SPA
//     emits for icons and metric-tooltip glyphs.
//
//   - frame-ancestors 'none', base-uri 'none', form-action 'self',
//     object-src 'none' lock down clickjacking, base-rewrite, form
//     redirect, and plugin loading respectively.
const CSPDirective = "default-src 'self'; " +
	"script-src 'self' 'wasm-unsafe-eval'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"worker-src 'self' blob:; " +
	"connect-src 'self' wss:; " +
	"img-src 'self' data:; " +
	"font-src 'self' data:; " +
	"frame-ancestors 'none'; " +
	"base-uri 'none'; " +
	"form-action 'self'; " +
	"object-src 'none'"

// PermissionsPolicyDirective denies the most-abused powerful features:
// camera, microphone, and geolocation (which the UI does not use), plus
// interest-cohort (FLoC opt-out belt and braces for tracking-leakage
// hardening).
const PermissionsPolicyDirective = "camera=(), microphone=(), geolocation=(), interest-cohort=()"

// COOPDirective is "same-origin" — the conservative default. It enables
// cross-origin-isolated semantics enough to defend against window.opener
// attacks without requiring COEP, which would conflict with the data:
// images the SPA embeds. COEP can be revisited once the SPA inlines no
// data: bodies.
const COOPDirective = "same-origin"

// WithPermissionsPolicy wraps next so every response carries the
// Permissions-Policy header. The header is short, browser-only, and
// harmless on API responses.
func WithPermissionsPolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Permissions-Policy", PermissionsPolicyDirective)
		next.ServeHTTP(w, r)
	})
}

// AccessTokenSunsetDate is the date after which `?access_token=` query
// fallback is removed. Surfaced as the Sunset response header per
// RFC 8594 so API consumers can plan migration. Closes SEC-F5 (#71).
//
// The fallback exists because browsers cannot set Authorization headers
// on the WebSocket upgrade request — the canonical replacement is the
// `geode-ui-auth` cookie (Secure, HttpOnly, SameSite=Lax) plus the
// `X-CSRF-Token` double-submit pattern wired in SEC-F7 (#62). When this
// date passes, the extractToken() fallback at internal/server/auth.go:88
// is REFUSED for non-WS endpoints (the WS surface is exempt because
// browsers cannot attach the Authorization header to the upgrade
// request); see accessTokenQuerySunsetReached in auth.go.
const AccessTokenSunsetDate = "Wed, 01 Jul 2026 00:00:00 GMT"

// AccessTokenSunsetTime is AccessTokenSunsetDate parsed once at init so
// the post-sunset refusal check in extractToken (auth.go) doesn't have
// to parse the string on every request. The two constants MUST stay in
// sync; init() validates the parse and panics on a typo so a future
// edit can't silently desync them.
var AccessTokenSunsetTime time.Time

func init() {
	t, err := time.Parse(time.RFC1123, AccessTokenSunsetDate)
	if err != nil {
		// A bad constant at package init means the binary is broken
		// before any request hits the wire; panicking is the only
		// signal that surfaces in a production deploy.
		panic("server: AccessTokenSunsetDate is not a valid RFC1123 date: " + err.Error())
	}
	AccessTokenSunsetTime = t
}

// accessTokenQueryCounter is the SEC-NEW-6 (#206) expvar-backed counter
// for every request that arrives with the deprecated `?access_token=`
// query parameter. Registered under the conventional Prometheus name
// `security_access_token_query_total` so the existing
// /debug/vars surface (and any Prometheus expvar exporter wired to it)
// can scrape it. Reads via accessTokenQueryTotal() for tests.
var accessTokenQueryCounter = expvar.NewInt("security_access_token_query_total")

// accessTokenQueryTotal returns the current value of the SEC-NEW-6
// counter. Exported for tests; production callers should scrape the
// expvar surface instead.
func accessTokenQueryTotal() int64 { return accessTokenQueryCounter.Value() }

// accessTokenAuditWindow is how long a path can pass between audit
// emissions before the limiter re-opens. The window is intentionally
// loose (10 s) — the goal is to avoid log floods, not to dedupe every
// burst. Each (path) key emits at most one audit per window.
const accessTokenAuditWindow = 10 * time.Second

// accessTokenAuditLimiterState backs the per-path one-shot emission
// limiter used by WithAccessTokenDeprecation. The map keys on request
// path so /api/v1/whoami floods do not silence /api/v1/users floods
// (which would mask a different deprecated client surfacing later).
// nowFn is overridable for the regression tests.
var (
	accessTokenAuditMu   sync.Mutex
	accessTokenAuditLast = map[string]time.Time{}
	accessTokenAuditNow  atomic.Pointer[func() time.Time]
)

// resetAccessTokenAuditLimiter wipes the per-path emission ledger so
// tests can re-arm the limiter between cases.
func resetAccessTokenAuditLimiter() {
	accessTokenAuditMu.Lock()
	defer accessTokenAuditMu.Unlock()
	accessTokenAuditLast = map[string]time.Time{}
}

// shouldEmitAccessTokenAudit reports whether the audit emission for path
// is allowed in the current window. State-mutating: a true return
// records the emission timestamp so the next call within the window
// returns false.
func shouldEmitAccessTokenAudit(path string) bool {
	nowFn := time.Now
	if p := accessTokenAuditNow.Load(); p != nil {
		nowFn = *p
	}
	now := nowFn()
	accessTokenAuditMu.Lock()
	defer accessTokenAuditMu.Unlock()
	if last, ok := accessTokenAuditLast[path]; ok {
		if now.Sub(last) < accessTokenAuditWindow {
			return false
		}
	}
	accessTokenAuditLast[path] = now
	return true
}

// WithAccessTokenDeprecation wraps next so any request that arrived with
// `?access_token=` on the URL gets a Deprecation: true + Sunset: <date>
// response header. Browsers, intermediaries, and API clients log these
// as advisory; the auth path still works until AccessTokenSunsetDate.
//
// SEC-NEW-6 (#206): every such request ALSO increments the
// `security_access_token_query_total` expvar counter (no throttling —
// counters are cheap and operators want true counts) AND emits a
// rate-limited `audit_event=access_token_query` audit record with the
// request path + User-Agent so operators can see who is still using
// the deprecated surface and plan migration. The audit emission is
// per-path-throttled to avoid log floods; the counter is not.
//
// The check runs unconditionally on the request URL (not the auth
// context) so the deprecation signal is emitted even when the token
// was rejected — that's intentional, because the goal is to nudge the
// caller off the query-string surface regardless of the response code.
func WithAccessTokenDeprecation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL != nil && r.URL.Query().Get("access_token") != "" {
			w.Header().Set("Deprecation", "true")
			w.Header().Set("Sunset", AccessTokenSunsetDate)
			w.Header().Set("Link",
				`<https://geodedb.com/docs/auth/cookie-mode>; rel="deprecation"`)
			accessTokenQueryCounter.Add(1)
			path := ""
			if r.URL != nil {
				path = r.URL.Path
			}
			if shouldEmitAccessTokenAudit(path) {
				emitAudit("access_token_query",
					"path", path,
					"user_agent", r.UserAgent(),
				)
			}
		}
		next.ServeHTTP(w, r)
	})
}

// WithSPASecurityHeaders wraps next (the SPA file-server handler) and
// emits CSP + COOP for HTML responses. JSON / asset responses pass
// through untouched. The wrapper buffers the response status line and
// inspects Content-Type before flushing, because the SPA file-server
// emits HTML for unknown paths (the SPA-fallback rewrite in
// internal/ui/embed.go) without explicitly setting Content-Type — the
// header has to land before the body.
func WithSPASecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &spaHeaderWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		// Trailing flush: if the inner handler wrote nothing (e.g. a
		// 304 with empty body) finalize anyway so headers are correct.
		sw.finalize()
	})
}

// spaHeaderWriter wraps http.ResponseWriter to defer the WriteHeader call
// until the Content-Type is known, then injects CSP/COOP if the response
// is HTML.
type spaHeaderWriter struct {
	http.ResponseWriter
	wroteHeader bool
	status      int
	// sniffed records whether we have sniffed the body once so the
	// CSP/COOP injection only runs on the first Write call.
	sniffed bool
}

func (s *spaHeaderWriter) WriteHeader(status int) {
	if s.wroteHeader {
		return
	}
	s.status = status
	s.injectIfHTML(nil)
	s.wroteHeader = true
	s.ResponseWriter.WriteHeader(status)
}

func (s *spaHeaderWriter) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		// Sniff the body once so the SPA fallback (which writes HTML
		// without setting Content-Type) is recognised.
		s.injectIfHTML(b)
		s.wroteHeader = true
		s.ResponseWriter.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(b)
}

// finalize handles handlers that neither WriteHeader nor Write — rare,
// but possible for OPTIONS or 204 responses generated by an upstream
// middleware. We still set CSP if the inner handler set Content-Type
// HTML (defensive, no-op otherwise).
func (s *spaHeaderWriter) finalize() {
	if s.wroteHeader {
		return
	}
	s.injectIfHTML(nil)
	s.wroteHeader = true
	s.ResponseWriter.WriteHeader(http.StatusOK)
}

// injectIfHTML decides whether to apply CSP/COOP based on the
// Content-Type the inner handler set, falling back to net/http's
// DetectContentType when no explicit type was given (the FileServer's
// SPA-fallback path writes HTML without a Content-Type).
func (s *spaHeaderWriter) injectIfHTML(body []byte) {
	if s.sniffed {
		return
	}
	s.sniffed = true
	ct := s.ResponseWriter.Header().Get("Content-Type")
	if ct == "" && len(body) > 0 {
		ct = http.DetectContentType(body)
	}
	if !isHTMLContentType(ct) {
		return
	}
	h := s.Header()
	if h.Get("Content-Security-Policy") == "" {
		h.Set("Content-Security-Policy", CSPDirective)
	}
	if h.Get("Cross-Origin-Opener-Policy") == "" {
		h.Set("Cross-Origin-Opener-Policy", COOPDirective)
	}
}

// isHTMLContentType reports whether the supplied Content-Type header
// (possibly with charset suffix) names an HTML body.
func isHTMLContentType(ct string) bool {
	ct = strings.TrimSpace(strings.ToLower(ct))
	if ct == "" {
		return false
	}
	// Trim the parameters portion (e.g. "; charset=utf-8") before
	// comparing, since the SPA index emits "text/html; charset=utf-8".
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct == "text/html" || ct == "application/xhtml+xml"
}
