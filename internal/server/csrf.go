package server

// CSRF double-submit middleware (SEC-F7 / #62 S3b).
//
// Threat model. The S3a cookie writer makes the geode-ui-auth JWT
// HttpOnly + SameSite=Strict, which is sufficient to defeat naive
// cross-site form-POST CSRF. SameSite=Strict drops the cookie on any
// cross-site navigation, so an attacker hosted at evil.com can no
// longer pre-authenticate the browser when a victim follows a link or
// submits a hidden form.
//
// We add CSRF on top of SameSite for defense in depth: the SameSite
// model relies on browser correctness (lax browsers, misconfigured
// proxies, ancient Safari quirks), and the geodedb deployment surface
// includes admin endpoints (POST /api/v1/users, DELETE /api/v1/policies/...,
// POST /api/v1/grants) where a bypass would be catastrophic.
//
// Pattern. Double-submit cookie with a separate, NON-HttpOnly token:
//   GET /api/v1/csrf  -> sets Set-Cookie: geode-ui-csrf=<token>
//                          (SameSite=Strict, NOT HttpOnly so SPA reads it)
//                        and returns {"token": "<token>"}
//
//   POST/PATCH/DELETE -> client adds X-CSRF-Token: <token>
//                          server compares header to cookie; constant-time
//
// Scope. csrfMiddleware enforces only when:
//   - method is unsafe (POST, PUT, PATCH, DELETE)
//   - auth source is the cookie (i.e., a browser session)
//   - path is not exempt (login/logout/csrf-issuance/health)
//
// Bearer-authenticated calls are skipped: a browser cannot forge an
// Authorization header from a third-party origin without explicit JS
// that already has same-origin DOM access — at which point the CSRF
// model cannot help anyway.
//
// Token lifecycle. /api/v1/csrf mints a fresh 32-byte token each call.
// The SPA fetches it after login and re-fetches on 403 to recover from
// expired cookies. Binding the token to the JTI would be more robust
// but JWT revocation is intentionally out of scope for #62 (tracked as
// SEC-N2). Per-request issuance plus SameSite=Strict is the security
// floor we set here; the binding can be tightened in a follow-up
// without changing the SPA contract.

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// CSRFCookieName is the cookie carrying the CSRF token. NOT HttpOnly so
// the SPA can read it via document.cookie and echo it back on
// state-changing requests.
const CSRFCookieName = "geode-ui-csrf"

// CSRFHeaderName is the header the SPA must set to the cookie value
// for double-submit verification. The "X-" prefix is conventional and
// signals the value is application-controlled (not a browser-managed
// header).
const CSRFHeaderName = "X-CSRF-Token"

// CSRFEndpointPath is the route that mints a fresh token. Public —
// no auth required, since the SPA fetches it before login completes.
const CSRFEndpointPath = "/api/v1/csrf"

// csrfTokenLen is the entropy size of a token in bytes. 32 bytes -> 64
// hex chars; 256 bits of randomness, dwarfing any plausible brute-force
// budget within a per-session token's lifetime.
const csrfTokenLen = 32

// newCSRFToken returns a fresh hex-encoded token sourced from crypto/rand.
// Returns an error only if the system entropy source is broken — which
// indicates a deeper failure that should crash any subsequent request
// rather than fall back to a weaker source.
func newCSRFToken() (string, error) {
	b := make([]byte, csrfTokenLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HandleCSRF mints a fresh token, sets it on the geode-ui-csrf cookie,
// and returns it in the response body. Idempotent in the sense that
// calling it again issues a new token — the SPA must store the latest.
//
// Wired in cmd/server/main.go as a hand-rolled handler outside genapi
// so we don't need to extend the spec for a security-only side
// channel.
func (s *GraphServer) HandleCSRF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	tok, err := newCSRFToken()
	if err != nil {
		http.Error(w, "csrf: token mint failed", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: false, // SPA must read this via document.cookie
		Secure:   s.cfg.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"token": tok})
}

// csrfCheck verifies that a request's X-CSRF-Token header matches its
// geode-ui-csrf cookie via a constant-time compare. Both values must be
// present and non-empty; otherwise the request is rejected.
func csrfCheck(r *http.Request) error {
	header := strings.TrimSpace(r.Header.Get(CSRFHeaderName))
	if header == "" {
		return errors.New("csrf: missing X-CSRF-Token header")
	}
	c, err := r.Cookie(CSRFCookieName)
	if err != nil || c == nil || c.Value == "" {
		return errors.New("csrf: missing geode-ui-csrf cookie")
	}
	if subtle.ConstantTimeCompare([]byte(header), []byte(c.Value)) != 1 {
		return errors.New("csrf: token mismatch")
	}
	return nil
}

// csrfExemptPaths is the set of paths the middleware never enforces
// against. Login is exempt because the user is not yet authenticated
// (no CSRF cookie is in scope yet); /api/v1/csrf is the source of the
// token. /healthz is unauthenticated read-only.
//
// S-NEW-G (#318): `/api/v1/auth/logout` used to live here because the
// operation is idempotent. SameSite=Strict already blocks the cross-
// site post for evergreen browsers, but the defense-in-depth contract
// the rest of the CSRF surface honours is "every authenticated state-
// changing request carries a CSRF token." The SPA already attaches
// the token on every non-safe method via src/api/csrf.ts:isCsrfRequired,
// so the exemption was purely a server-side blind spot. Removing it
// closes the gap without any client-side change.
//
// The map is keyed by exact path; any sub-path under these names is
// NOT exempt unless added explicitly.
var csrfExemptPaths = map[string]struct{}{
	"/api/v1/auth/login": {},
	CSRFEndpointPath:     {},
	"/api/v1/healthz":    {},
	"/healthz":           {},
}

// isSafeMethod reports whether the HTTP method is read-only by RFC 9110
// semantics. Only unsafe methods are subject to CSRF enforcement.
func isSafeMethod(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return false
}

// CSRFMiddleware is the exported alias for csrfMiddleware so cmd/server
// can wrap the handler chain. The lower-case symbol is the canonical
// implementation; this thin re-export keeps the test suite (which
// references csrfMiddleware) and the wiring layer aligned.
func CSRFMiddleware(next http.Handler) http.Handler { return csrfMiddleware(next) }

// csrfMiddleware wraps the next handler with double-submit enforcement.
// Logic:
//   - Safe methods (GET/HEAD/OPTIONS): pass through
//   - Exempt paths (auth/login, auth/logout, /api/v1/csrf, healthz): pass through
//   - Auth source is anything other than cookie: pass through
//     (Bearer auth is by definition cross-origin-safe; no auth is
//     handled by the downstream AuthJWT 401)
//   - Otherwise: csrfCheck must succeed; on failure 403.
//
// IMPORTANT: csrfMiddleware MUST run AFTER AuthJWT has populated the
// auth-source context. In production wiring (cmd/server/main.go) the
// genapi router runs AuthJWT inline as part of its per-route handler,
// so a global wrapping middleware would not see the source.
//
// To resolve this, the middleware uses a probe: if no auth-source
// context value is present (AuthJWT hasn't run), it inspects the raw
// request for a cookie. If the request carries the auth cookie but
// not the Authorization header, it's a browser session and CSRF
// applies. The probe is conservative — it errs toward enforcement.
func csrfMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		if _, exempt := csrfExemptPaths[r.URL.Path]; exempt {
			next.ServeHTTP(w, r)
			return
		}
		// Decide enforcement scope. If AuthJWT has run, prefer its
		// recorded source; otherwise probe the raw request.
		src := authSourceFromContext(r.Context())
		if src == authSourceNone {
			src = sourceForRequest(r)
		}
		switch src {
		case authSourceHeader:
			// Programmatic Bearer caller — exempt.
			next.ServeHTTP(w, r)
			return
		case authSourceQuery:
			// Querystring tokens are WS-only; if one shows up on a
			// REST POST something is wrong — block.
			http.Error(w, "csrf: query-token auth not allowed for state-changing requests", http.StatusForbidden)
			return
		case authSourceCookie:
			if err := csrfCheck(r); err != nil {
				http.Error(w, err.Error(), http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
			return
		default:
			// No auth credentials on the request — let the downstream
			// AuthJWT emit its 401. CSRF is irrelevant for an
			// unauthenticated request.
			next.ServeHTTP(w, r)
			return
		}
	})
}
