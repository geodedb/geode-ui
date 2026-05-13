package server

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"geodedb.com/geode-ui/internal/jwt"
)

// profilelimiter.go closes GAP-S7 (#120): adds a per-actor (JWT subject)
// token bucket around the profile CRUD surface. Pre-fix, only
// /api/v1/auth/login was wrapped (loginlimiter.go); a single
// authenticated user could hammer POST/PATCH/DELETE on /api/v1/profiles
// at line rate. The genapi-emitted route carries a global per-route
// bucket but no per-actor partitioning, so a single noisy client could
// drain that bucket and starve everyone else.
//
// Design notes:
//
//   - The wrapper inspects path/method and only acts on the four CRUD
//     verbs against /api/v1/profiles and /api/v1/profiles/{id}. Read
//     paths (GET) and the public list (GET /api/v1/profiles/public)
//     pass through; this is mutating-only.
//
//   - The actor key is the JWT subject extracted from the request via
//     the same priority order as auth.go's extractToken (Authorization
//     header, geode-ui-auth cookie, ?access_token= query). When no
//     valid token is presented (e.g. malformed bearer, expired) the
//     downstream genapi middleware will 401 it anyway; we fall back to
//     per-IP keying using clientIP() so an unauthenticated flood of
//     malformed POSTs still costs the attacker their IP bucket. The IP
//     fallback uses a key prefix of "ip\x00" so it cannot collide with
//     a real subject.
//
//   - Default ceiling: 30 req/min per actor, burst 10. Tunables exposed
//     via ProfileLimiterConfig so deployments can tighten/loosen.
//
//   - On 429 the wrapper emits an audit event so abuse is visible in
//     the same audit ring that already carries login/profile events.
//
//   - The wrapper wraps an http.Handler (not just a single route) so it
//     can be mounted around the genapi-emitted mux without fighting
//     Go 1.22+ ServeMux's same-pattern conflict rule. Path/method
//     gating happens in the wrapper itself.

// ProfileLimiterConfig carries the tunables. Defaults via
// ProfileLimiterDefaults().
type ProfileLimiterConfig struct {
	// PerActorRate is the steady-state requests/second allowed per
	// actor. Default 0.5 (= 30 req/min).
	PerActorRate float64
	// PerActorBurst is the max sustained burst per actor. Default 10.
	PerActorBurst float64
	// JWT is the issuer used to extract the actor subject. May be nil;
	// if nil, every request falls back to per-IP keying (test-friendly).
	JWT *jwt.Issuer
	// Now returns the wall clock; injected for tests. Defaults to
	// time.Now.
	Now func() time.Time
	// TrustProxyXFF controls whether clientIP() honors the leading hop
	// of X-Forwarded-For when computing the per-IP fallback key
	// (used when no valid JWT is presented). Default false (S-NEW-5
	// #201 hardening). Set true only when the binary sits behind a
	// TLS-terminating reverse proxy the operator controls.
	TrustProxyXFF bool
}

// ProfileLimiterDefaults applies production defaults: 30 req/min per
// actor with burst 10. Production callers can pass an empty
// ProfileLimiterConfig{} (with JWT set) and let NewProfileLimiter fill
// these in.
func ProfileLimiterDefaults() ProfileLimiterConfig {
	return ProfileLimiterConfig{
		PerActorRate:  0.5, // 30 req/min
		PerActorBurst: 10,
		Now:           time.Now,
	}
}

// ProfileLimiter holds per-actor token buckets. Concurrent-safe.
type ProfileLimiter struct {
	cfg ProfileLimiterConfig

	mu       sync.Mutex
	perActor map[string]*ipBucket
}

// NewProfileLimiter constructs a ProfileLimiter, applying defaults for
// any zero-valued tunable. Pass time.Now (or a fake) as cfg.Now in
// tests.
func NewProfileLimiter(cfg ProfileLimiterConfig) *ProfileLimiter {
	def := ProfileLimiterDefaults()
	if cfg.PerActorRate <= 0 {
		cfg.PerActorRate = def.PerActorRate
	}
	if cfg.PerActorBurst <= 0 {
		cfg.PerActorBurst = def.PerActorBurst
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &ProfileLimiter{
		cfg:      cfg,
		perActor: make(map[string]*ipBucket),
	}
}

// Allow reports whether a profile-CRUD attempt for actor `key` may
// proceed. On reject it returns the recommended Retry-After. The key
// is opaque -- the wrapper composes it from the JWT subject (or an
// "ip\x00<ip>" fallback for unauthenticated callers).
func (l *ProfileLimiter) Allow(key string) (bool, time.Duration) {
	now := l.cfg.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	bkt, ok := l.perActor[key]
	if !ok {
		bkt = &ipBucket{tokens: l.cfg.PerActorBurst, last: now}
		l.perActor[key] = bkt
	}
	dt := now.Sub(bkt.last).Seconds()
	if dt < 0 {
		dt = 0
	}
	bkt.tokens += dt * l.cfg.PerActorRate
	if bkt.tokens > l.cfg.PerActorBurst {
		bkt.tokens = l.cfg.PerActorBurst
	}
	bkt.last = now
	if bkt.tokens < 1 {
		retry := time.Duration((1.0 - bkt.tokens) / l.cfg.PerActorRate * float64(time.Second))
		if retry < time.Second {
			retry = time.Second
		}
		return false, retry
	}
	bkt.tokens -= 1
	return true, 0
}

// isProfileCRUDPath reports whether (method, path) targets the
// authenticated profile CRUD surface (POST list-create, PATCH/DELETE
// per-id). GET-list and GET-by-id are read paths; the public list is
// anonymous-allowed; none are limited here.
func isProfileCRUDPath(method, path string) bool {
	switch method {
	case http.MethodPost:
		return path == "/api/v1/profiles"
	case http.MethodPatch, http.MethodDelete:
		// /api/v1/profiles/{id} -- accept any single trailing segment.
		const prefix = "/api/v1/profiles/"
		if !strings.HasPrefix(path, prefix) {
			return false
		}
		rest := path[len(prefix):]
		if rest == "" || rest == "public" {
			return false
		}
		// Reject deeper paths (no nested resources are CRUD'd here).
		return !strings.ContainsRune(rest, '/')
	}
	return false
}

// actorKey returns the per-actor bucket key for a request. Priority:
//
//  1. Verified JWT subject (when l.cfg.JWT is non-nil and the token
//     parses cleanly). The key carries a "u\x00" prefix so it cannot
//     collide with the IP fallback.
//  2. clientIP() with an "ip\x00" prefix. Used when no JWT issuer is
//     configured, no token is presented, or the token is malformed /
//     expired (the downstream genapi middleware will 401 it anyway --
//     the IP bucket is what stops a flood of malformed POSTs from
//     being free).
func (l *ProfileLimiter) actorKey(r *http.Request) string {
	if l.cfg.JWT != nil {
		if tok, err := extractToken(r); err == nil {
			if claims, err := l.cfg.JWT.Parse(tok); err == nil && claims.Subject != "" {
				return "u\x00" + claims.Subject
			}
		}
	}
	return "ip\x00" + clientIP(r, l.cfg.TrustProxyXFF)
}

// WrapProfileLimit wraps next so any POST /api/v1/profiles or
// PATCH/DELETE /api/v1/profiles/{id} traffic flows through the
// per-actor limiter. Every other request (including the GET read
// paths) passes through unchanged.
func WrapProfileLimit(l *ProfileLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isProfileCRUDPath(r.Method, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		key := l.actorKey(r)
		ok, retry := l.Allow(key)
		if !ok {
			rejectProfileCRUD(w, retry)
			emitAudit(auditEventProfileRateLimited,
				"key", key,
				"method", r.Method,
				"path", r.URL.Path,
				"ip", clientIP(r, l.cfg.TrustProxyXFF),
			)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rejectProfileCRUD emits a 429 with Retry-After. Body shape mirrors
// rejectLogin so the SPA's existing 429 handler covers both surfaces.
func rejectProfileCRUD(w http.ResponseWriter, retry time.Duration) {
	if retry < time.Second {
		retry = time.Second
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(retry/time.Second)))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"code":"rate_limited","description":"too many profile CRUD attempts; try again later","reason":"actor_rate_limited"}`))
}
