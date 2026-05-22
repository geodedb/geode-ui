package server

import (
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// onboardlimiter.go closes the login-profile-ux follow-up #2: a per-IP
// token bucket on POST /api/v1/profiles/onboard. The endpoint is
// unauthenticated (it IS the bootstrap path) and opens an upstream QUIC
// `*sql.DB` against a caller-supplied DSN to validate caller-supplied
// admin credentials. Without a per-IP limiter the route is a
// credential-spray amplifier: an attacker can use the geode-ui process
// as a probe relay to test creds against arbitrary reachable Geodes at
// line rate.
//
// Design notes mirror loginlimiter.go / profilelimiter.go:
//
//   - The wrapper inspects path/method and only acts on
//     POST /api/v1/profiles/onboard. Every other request passes
//     through with the cost of one string compare + one method check.
//
//   - Per-IP keying via clientIP() with the same trust-proxy-xff
//     semantics as the login limiter, so an operator that flips
//     `-trust-proxy-xff=true` gets consistent header trust across every
//     hand-rolled limited endpoint.
//
//   - Defaults are deliberately TIGHT — 1 rps with burst 5 — because
//     operators onboard a small N profiles TOTAL during initial setup
//     (and rare add-from-login flows afterwards), not per-day-per-user
//     like the login surface. A burst of 5 covers the SPA's clumsy-
//     retry / first-run-double-submit failure modes without leaving
//     headroom for spraying.
//
//   - On 429 the wrapper emits an audit event with
//     reason="rate_limited" so the abuse trace shows up in the same
//     audit ring that already carries the onboard success/failure
//     rows. Mirrors the reason-classifier vocabulary established by
//     HandleOnboard ("validation" / "upstream_rejected" /
//     "duplicate_name" / …).

// OnboardLimiterConfig carries the tunables. Defaults via
// OnboardLimiterDefaults().
type OnboardLimiterConfig struct {
	// PerIPRate is the steady-state requests/second allowed per remote
	// IP. Default 1.
	PerIPRate float64
	// PerIPBurst is the max sustained burst per IP. Default 5.
	PerIPBurst float64
	// Now returns the wall clock; injected for tests. Defaults to
	// time.Now.
	Now func() time.Time
	// TrustProxyXFF controls whether clientIP() honors the leading hop
	// of X-Forwarded-For. Default false (S-NEW-5 #201 hardening). Set
	// true only when the binary sits behind a TLS-terminating reverse
	// proxy the operator controls and that proxy strips/normalises any
	// inbound XFF header.
	TrustProxyXFF bool
	// MaxIdle is the duration after which an unused per-IP bucket is
	// eligible for eviction by the TTL janitor. Default 24h. A zero or
	// negative value disables eviction entirely.
	MaxIdle time.Duration
	// PruneInterval is how often the TTL janitor goroutine sweeps the
	// perIP map. Default 5 minutes. A zero or negative value disables
	// the janitor (cap-trim still fires on the insert path).
	PruneInterval time.Duration
	// MaxEntries is the hard ceiling on the perIP map cardinality.
	// Default 100,000. Set <= 0 to disable the cap (NOT recommended;
	// the cap is the panic-prevention floor against an attacker that
	// rotates the bucket key on every request).
	MaxEntries int
}

// OnboardLimiterDefaults applies production defaults (1 rps per IP,
// burst 5, 24h idle eviction, 5-min janitor cadence, 100k entries cap).
// Production callers can pass an empty OnboardLimiterConfig{} and let
// NewOnboardLimiter fill these in.
//
// The defaults are deliberately tighter than the login limiter's (5 rps
// / burst 10) because the onboard endpoint is unauthenticated and a
// human operator hits it a handful of times total, not per-day.
func OnboardLimiterDefaults() OnboardLimiterConfig {
	return OnboardLimiterConfig{
		PerIPRate:     1,
		PerIPBurst:    5,
		Now:           time.Now,
		MaxIdle:       24 * time.Hour,
		PruneInterval: 5 * time.Minute,
		MaxEntries:    100_000,
	}
}

// OnboardLimiter holds per-IP token buckets for the onboard endpoint.
// Concurrent-safe. Re-uses the ipBucket type defined in loginlimiter.go
// so the per-bucket mutex + tokens/last fields stay consistent across
// the per-IP limiter family.
//
// Same 2-map COW design as LoginLimiter / ProfileLimiter: hot path is
// atomic.Load + map lookup + per-bucket mutex; insert (cold path)
// takes the writer mutex and copy-on-writes a new map. See the
// LoginLimiter comment for the full correctness argument.
type OnboardLimiter struct {
	cfg OnboardLimiterConfig

	perIP   atomic.Pointer[map[string]*ipBucket]
	writeMu sync.Mutex

	janitorStop chan struct{}
	janitorOnce sync.Once
}

// NewOnboardLimiter constructs an OnboardLimiter, applying defaults for
// any zero-valued tunable. Pass time.Now (or a fake) as cfg.Now in
// tests.
//
// NOTE: NewOnboardLimiter does NOT spawn the TTL janitor goroutine;
// call StartJanitor() once at startup to begin background pruning.
// Tests that drive Allow() synchronously can call PruneOnce() directly.
func NewOnboardLimiter(cfg OnboardLimiterConfig) *OnboardLimiter {
	def := OnboardLimiterDefaults()
	if cfg.PerIPRate <= 0 {
		cfg.PerIPRate = def.PerIPRate
	}
	if cfg.PerIPBurst <= 0 {
		cfg.PerIPBurst = def.PerIPBurst
	}
	if cfg.Now == nil {
		cfg.Now = def.Now
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
	l := &OnboardLimiter{cfg: cfg}
	empty := make(map[string]*ipBucket)
	l.perIP.Store(&empty)
	return l
}

// Allow reports whether an onboard attempt from `ip` may proceed. On
// reject it returns the recommended Retry-After.
//
// Hot path: atomic.Load map → lookup → per-bucket mutex. No global
// lock on cache-hit traffic.
func (l *OnboardLimiter) Allow(ip string) (bool, time.Duration) {
	now := l.cfg.Now()
	current := *l.perIP.Load()
	bkt, ok := current[ip]
	if !ok {
		bkt = l.insertBucket(ip, now)
	}
	bkt.mu.Lock()
	dt := now.Sub(bkt.last).Seconds()
	if dt < 0 {
		dt = 0
	}
	bkt.tokens += dt * l.cfg.PerIPRate
	if bkt.tokens > l.cfg.PerIPBurst {
		bkt.tokens = l.cfg.PerIPBurst
	}
	bkt.last = now
	if bkt.tokens < 1 {
		shortfall := 1.0 - bkt.tokens
		bkt.mu.Unlock()
		retry := time.Duration(shortfall / l.cfg.PerIPRate * float64(time.Second))
		if retry < time.Second {
			retry = time.Second
		}
		return false, retry
	}
	bkt.tokens -= 1
	bkt.mu.Unlock()
	return true, 0
}

// insertBucket COW-inserts a new bucket for ip. Mirrors
// ProfileLimiter.insertBucket — same cap-trim discipline (10% batch
// drop on overflow so trim cost amortises across inserts).
func (l *OnboardLimiter) insertBucket(ip string, now time.Time) *ipBucket {
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	current := *l.perIP.Load()
	if bkt, ok := current[ip]; ok {
		return bkt
	}
	if l.cfg.MaxEntries > 0 && len(current) >= l.cfg.MaxEntries {
		batch := l.cfg.MaxEntries / 10
		if batch < 1 {
			batch = 1
		}
		current = trimOldestIPBuckets(current, l.cfg.MaxEntries-batch)
	}
	bkt := &ipBucket{tokens: l.cfg.PerIPBurst, last: now}
	next := make(map[string]*ipBucket, len(current)+1)
	for k, v := range current {
		next[k] = v
	}
	next[ip] = bkt
	l.perIP.Store(&next)
	return bkt
}

// StartJanitor spawns the background TTL janitor goroutine. Idempotent.
// See LoginLimiter.StartJanitor for the contract.
func (l *OnboardLimiter) StartJanitor() {
	if l.cfg.PruneInterval <= 0 {
		return
	}
	l.janitorOnce.Do(func() {
		l.janitorStop = make(chan struct{})
		go l.janitorLoop()
	})
}

// Stop signals the TTL janitor to terminate. Idempotent.
func (l *OnboardLimiter) Stop() {
	if l.janitorStop != nil {
		select {
		case <-l.janitorStop:
			// already closed
		default:
			close(l.janitorStop)
		}
	}
}

func (l *OnboardLimiter) janitorLoop() {
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

// PruneOnce sweeps the perIP map and removes buckets idle for more
// than cfg.MaxIdle. Also enforces cfg.MaxEntries by trimming the
// oldest entries when needed. Returns the number of evicted entries.
func (l *OnboardLimiter) PruneOnce() int {
	if l.cfg.MaxIdle <= 0 && l.cfg.MaxEntries <= 0 {
		return 0
	}
	now := l.cfg.Now()
	l.writeMu.Lock()
	defer l.writeMu.Unlock()
	current := *l.perIP.Load()
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
	l.perIP.Store(&next)
	return removed
}

// PerIPCount returns the current cardinality of the perIP map. Used by
// tests to assert eviction behaviour.
func (l *OnboardLimiter) PerIPCount() int {
	return len(*l.perIP.Load())
}

// WrapOnboardLimit wraps next so any POST /api/v1/profiles/onboard
// traffic flows through the limiter. Every other request passes
// through unchanged. On a 429 the wrapper emits a
// profile_onboard_failure audit row with reason=rate_limited (mirroring
// the reason-classifier vocabulary HandleOnboard already uses for
// validation / upstream_rejected / duplicate_name / store_error /
// mint_failed).
func WrapOnboardLimit(l *OnboardLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/profiles/onboard" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r, l.cfg.TrustProxyXFF)
		ok, retry := l.Allow(ip)
		if !ok {
			rejectOnboard(w, retry)
			emitAudit(auditEventOnboardFailure,
				"reason", "rate_limited",
				"ip", ip,
			)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rejectOnboard emits a 429 with Retry-After. Body shape mirrors
// rejectLogin / rejectProfileCRUD so the SPA's existing 429 handler
// covers this surface too. Uses the ErrCodeRateLimited constant for
// the on-wire `code` value.
func rejectOnboard(w http.ResponseWriter, retry time.Duration) {
	if retry < time.Second {
		retry = time.Second
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(retry/time.Second)))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	body := `{"code":"` + ErrCodeRateLimited +
		`","description":"too many onboard attempts; try again later","reason":"ip_rate_limited"}`
	_, _ = w.Write([]byte(body))
}
