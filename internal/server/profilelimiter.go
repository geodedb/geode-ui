package server

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	// MaxIdle is the duration after which an unused per-actor bucket
	// is eligible for eviction by the TTL janitor (PERF #225). Default
	// 24h. A zero or negative value disables eviction entirely.
	MaxIdle time.Duration
	// PruneInterval is how often the TTL janitor goroutine sweeps the
	// perActor map. Default 5 minutes. A zero or negative value
	// disables the janitor (eviction only happens on the cap-trim
	// path).
	PruneInterval time.Duration
	// MaxEntries is the hard ceiling on the perActor map's
	// cardinality. When an insert would push the map past this size,
	// the cap-trim path removes the oldest entries first. Default
	// 100,000. Set <= 0 to disable the cap entirely (NOT recommended).
	MaxEntries int
}

// ProfileLimiterDefaults applies production defaults: 30 req/min per
// actor with burst 10, 24h idle eviction, 5-min janitor cadence, 100k
// entries cap (PERF #225). Production callers can pass an empty
// ProfileLimiterConfig{} (with JWT set) and let NewProfileLimiter fill
// these in.
func ProfileLimiterDefaults() ProfileLimiterConfig {
	return ProfileLimiterConfig{
		PerActorRate:  0.5, // 30 req/min
		PerActorBurst: 10,
		Now:           time.Now,
		MaxIdle:       24 * time.Hour,
		PruneInterval: 5 * time.Minute,
		MaxEntries:    100_000,
	}
}

// ProfileLimiter holds per-actor token buckets. Concurrent-safe.
//
// PERF-2026-05-13-06 (#220): same 2-map redesign as LoginLimiter. The
// perActor map is read-mostly; reads via atomic.Load + map lookup hit
// only a per-bucket mutex on the cache-hit path. Inserts (cold path)
// take a writer mutex and copy-on-write a new map. See the
// LoginLimiter comment for the full correctness argument.
type ProfileLimiter struct {
	cfg ProfileLimiterConfig

	perActor atomic.Pointer[map[string]*ipBucket]
	writeMu  sync.Mutex

	// janitorStop is closed by Stop() to terminate the TTL janitor
	// goroutine started by StartJanitor() (PERF #225).
	janitorStop chan struct{}
	janitorOnce sync.Once
}

// NewProfileLimiter constructs a ProfileLimiter, applying defaults for
// any zero-valued tunable. Pass time.Now (or a fake) as cfg.Now in
// tests.
//
// NOTE: NewProfileLimiter does NOT spawn the TTL janitor goroutine;
// call StartJanitor() once at startup to begin background pruning.
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
	if cfg.MaxIdle == 0 {
		cfg.MaxIdle = def.MaxIdle
	}
	if cfg.PruneInterval == 0 {
		cfg.PruneInterval = def.PruneInterval
	}
	if cfg.MaxEntries == 0 {
		cfg.MaxEntries = def.MaxEntries
	}
	l := &ProfileLimiter{cfg: cfg}
	empty := make(map[string]*ipBucket)
	l.perActor.Store(&empty)
	return l
}

// Allow reports whether a profile-CRUD attempt for actor `key` may
// proceed. On reject it returns the recommended Retry-After. The key
// is opaque -- the wrapper composes it from the JWT subject (or an
// "ip\x00<ip>" fallback for unauthenticated callers).
//
// Hot path: atomic.Load map → lookup → per-bucket mutex. No global
// lock on cache-hit traffic.
func (l *ProfileLimiter) Allow(key string) (bool, time.Duration) {
	now := l.cfg.Now()
	current := *l.perActor.Load()
	bkt, ok := current[key]
	if !ok {
		bkt = l.insertBucket(key, now)
	}
	bkt.mu.Lock()
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
		shortfall := 1.0 - bkt.tokens
		bkt.mu.Unlock()
		retry := time.Duration(shortfall / l.cfg.PerActorRate * float64(time.Second))
		if retry < time.Second {
			retry = time.Second
		}
		return false, retry
	}
	bkt.tokens -= 1
	bkt.mu.Unlock()
	return true, 0
}

// insertBucket COW-inserts a new bucket for key. Returns the inserted
// bucket (or, on a race, the bucket the winner installed).
//
// PERF #225: cap-trim discipline mirrors LoginLimiter.insertIPBucket.
func (l *ProfileLimiter) insertBucket(key string, now time.Time) *ipBucket {
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	current := *l.perActor.Load()
	if bkt, ok := current[key]; ok {
		return bkt
	}
	if l.cfg.MaxEntries > 0 && len(current) >= l.cfg.MaxEntries {
		batch := l.cfg.MaxEntries / 10
		if batch < 1 {
			batch = 1
		}
		current = trimOldestIPBuckets(current, l.cfg.MaxEntries-batch)
	}
	bkt := &ipBucket{tokens: l.cfg.PerActorBurst, last: now}
	next := make(map[string]*ipBucket, len(current)+1)
	for k, v := range current {
		next[k] = v
	}
	next[key] = bkt
	l.perActor.Store(&next)
	return bkt
}

// PERF #225: TTL janitor for ProfileLimiter.

// StartJanitor spawns the background TTL janitor goroutine. Idempotent.
// See LoginLimiter.StartJanitor for the contract.
func (l *ProfileLimiter) StartJanitor() {
	if l.cfg.PruneInterval <= 0 {
		return
	}
	l.janitorOnce.Do(func() {
		l.janitorStop = make(chan struct{})
		go l.janitorLoop()
	})
}

// Stop signals the TTL janitor to terminate. Idempotent.
func (l *ProfileLimiter) Stop() {
	if l.janitorStop != nil {
		select {
		case <-l.janitorStop:
			// already closed
		default:
			close(l.janitorStop)
		}
	}
}

func (l *ProfileLimiter) janitorLoop() {
	t := time.NewTicker(l.cfg.PruneInterval)
	defer t.Stop()
	for {
		select {
		case <-l.janitorStop:
			return
		case <-t.C:
			l.PruneOnce()
		}
	}
}

// PruneOnce sweeps the perActor map and removes buckets idle for more
// than cfg.MaxIdle. Also enforces cfg.MaxEntries by trimming the
// oldest entries when needed. Returns the number of evicted entries.
func (l *ProfileLimiter) PruneOnce() int {
	if l.cfg.MaxIdle <= 0 && l.cfg.MaxEntries <= 0 {
		return 0
	}
	now := l.cfg.Now()
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	current := *l.perActor.Load()
	if len(current) == 0 {
		return 0
	}
	next := make(map[string]*ipBucket, len(current))
	for k, b := range current {
		b.mu.Lock()
		idle := now.Sub(b.last)
		b.mu.Unlock()
		if l.cfg.MaxIdle <= 0 || idle <= l.cfg.MaxIdle {
			next[k] = b
		}
	}
	if l.cfg.MaxEntries > 0 && len(next) > l.cfg.MaxEntries {
		next = trimOldestIPBuckets(next, l.cfg.MaxEntries)
	}
	removed := len(current) - len(next)
	if removed == 0 {
		return 0
	}
	l.perActor.Store(&next)
	return removed
}

// PerActorCount returns the current cardinality of the perActor map.
// Used by tests to assert eviction behavior.
func (l *ProfileLimiter) PerActorCount() int {
	return len(*l.perActor.Load())
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

// auditableActorKey returns the actorKey with NUL separators replaced
// by a printable pipe character so the value can be embedded in audit
// records without truncating downstream SIEM ingestors. S-NEW-M
// (#325): a syslog-style consumer that treats NUL as an end-of-record
// silently dropped the "u" / "ip" prefix on every emit, leaving the
// audit row unable to disambiguate "user X hit the limit" from
// "IP X hit the limit." The NUL is load-bearing inside the limiter
// (it guarantees no collision between the two namespaces); replacing
// it for the AUDIT export only keeps that contract intact while
// fixing the observability gap. CWE-117 (improper output
// neutralization for logs).
func auditableActorKey(key string) string {
	return strings.ReplaceAll(key, "\x00", "|")
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
				"key", auditableActorKey(key),
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
