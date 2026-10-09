package server

import (
	"bytes"
	"io"
	"maps"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// loginLimiter closes SEC-F2 (#58) and SEC-N7 (#66): adds a per-IP token
// bucket and a per-(profile, username) lockout counter to the
// /api/v1/auth/login surface. The genapi-emitted route already carries a
// global per-route bucket (gen/api/handlers_gen.go:1471-1483), but that
// bucket is shared across all IPs and is therefore useless against a
// distributed credential-stuffing attempt. A structural fix in genapi
// (per-IP buckets in gen/pkg/httpx) is filed as a follow-up.
//
// Design notes:
//
//   - The bucket key is canonicalized at the wrapper boundary. The Login
//     handler defaults an empty profile to "default" silently
//     (handlers_auth.go:43-46 — see SEC-N3); the wrapper has to perform
//     the same canonicalization or a determined attacker could rotate
//     the profile field between "" and "default" to keep the lockout
//     bucket from converging. Doing the canonicalization here also
//     closes the wrapper's TOCTOU window — once we've decided the key,
//     the inner handler cannot retarget us.
//
//   - The wrapper wraps an entire http.Handler (not just the Login
//     route) and is mounted around the genapi-registered mux. Wrapping
//     the mux is necessary because Go 1.22+ ServeMux refuses two
//     handlers on the same exact pattern, so we cannot "register first,
//     genapi second". The wrapper inspects path/method and only acts on
//     POST /api/v1/auth/login; all other traffic passes through with no
//     overhead beyond a string compare.

// LoginLimiterConfig carries the tunables. Defaults below applied via
// LoginLimiterDefaults().
type LoginLimiterConfig struct {
	// PerIPRate is the steady-state requests/second allowed per remote
	// IP. Default 5.
	PerIPRate float64
	// PerIPBurst is the max sustained burst per IP. Default 10.
	PerIPBurst float64
	// FailThreshold is the number of consecutive (profile, username)
	// authentication failures that trip a lockout. Default 5.
	FailThreshold int
	// LockoutWindow is the duration a (profile, username) tuple is
	// locked out after FailThreshold consecutive fails. The fail
	// counter resets when LockoutWindow elapses since the last fail
	// or when NoteSuccess is called. Default 15 minutes.
	LockoutWindow time.Duration
	// Now returns the wall clock; injected for tests. Defaults to
	// time.Now.
	Now func() time.Time
	// TrustProxyXFF controls whether clientIP() honors the leading hop
	// of X-Forwarded-For. Default false (S-NEW-5 #201 hardening): the
	// per-IP rate-limit key is `net.SplitHostPort(r.RemoteAddr)` so a
	// public-internet attacker cannot rotate the key on every request
	// or trip lockouts against arbitrary innocent IPs. Set true only
	// when the binary sits behind a TLS-terminating reverse proxy the
	// operator controls and that proxy strips/normalises any inbound
	// XFF header.
	TrustProxyXFF bool
}

// LoginLimiterDefaults applies production defaults (5 rps per IP,
// burst 10, 5 fails -> 15-min lockout). Production callers can pass an
// empty LoginLimiterConfig{} and let NewLoginLimiter fill these in.
func LoginLimiterDefaults() LoginLimiterConfig {
	return LoginLimiterConfig{
		PerIPRate:     5,
		PerIPBurst:    10,
		FailThreshold: 5,
		LockoutWindow: 15 * time.Minute,
		Now:           time.Now,
	}
}

// LoginLimiter holds per-IP token buckets and per-(profile, username)
// lockout counters. Concurrent-safe.
//
// PERF-2026-05-13-06 (#220): the perIP and perUserFails maps are
// read-mostly and the original single-Mutex design serialised every
// Allow() / NoteFail() / NoteSuccess() call across the entire process.
// The 2-map redesign uses an atomic.Pointer[map] for each cache so the
// hot path (lookup of an existing key) is lock-free at the map level,
// and a per-bucket mutex on the bucket itself guards the token / counter
// fields. Inserts (cold path: first request from a new IP / first fail
// against a new (profile, user) pair) take a small "writer" mutex,
// copy-on-write the map, and atomically publish the new pointer.
//
// Correctness notes:
//
//   - Reads via atomic.Load see an immutable snapshot — the slot at
//     the lookup key cannot vanish underneath the reader because
//     entries are never removed except (a) under writeMu (deleteLockout
//     on expiry) and (b) the writer ALWAYS COWs into a new map. Stale
//     reads return a still-valid *bucket pointer; subsequent mutations
//     under the bucket's own mutex remain correct even if the bucket
//     was concurrently dropped from a newer map snapshot — the bucket
//     itself is still a real allocation, and the next request from
//     that key will simply observe an empty newer snapshot and insert
//     fresh.
//
//   - The two-map redesign trades a tiny insert-path overhead (COW the
//     whole map) for a much smaller hot-path overhead (single atomic
//     load + map lookup + per-bucket mutex). Insert is rare; lookup
//     dominates.
type LoginLimiter struct {
	cfg LoginLimiterConfig

	// perIP holds *map[string]*ipBucket. Reads via atomic.Load,
	// inserts via copy-on-write under perIPWriteMu.
	perIP        atomic.Pointer[map[string]*ipBucket]
	perIPWriteMu sync.Mutex

	// perUserFails holds *map[string]*userLockout. Same COW pattern as
	// perIP.
	perUserFails   atomic.Pointer[map[string]*userLockout]
	perUserWriteMu sync.Mutex
}

type ipBucket struct {
	// mu guards tokens + last. Held only during the short
	// refill/decrement window per Allow() call. Per-bucket scope means
	// concurrent goroutines on DIFFERENT keys never contend.
	mu     sync.Mutex
	tokens float64
	last   time.Time
}

type userLockout struct {
	// mu guards count + lastFail.
	mu       sync.Mutex
	count    int
	lastFail time.Time
}

// NewLoginLimiter constructs a LoginLimiter with cfg, applying defaults
// for any zero-valued tunable. Pass time.Now (or a fake) as cfg.Now in
// tests.
func NewLoginLimiter(cfg LoginLimiterConfig) *LoginLimiter {
	def := LoginLimiterDefaults()
	if cfg.PerIPRate <= 0 {
		cfg.PerIPRate = def.PerIPRate
	}
	if cfg.PerIPBurst <= 0 {
		cfg.PerIPBurst = def.PerIPBurst
	}
	if cfg.FailThreshold <= 0 {
		cfg.FailThreshold = def.FailThreshold
	}
	if cfg.LockoutWindow <= 0 {
		cfg.LockoutWindow = def.LockoutWindow
	}
	if cfg.Now == nil {
		cfg.Now = def.Now
	}
	l := &LoginLimiter{cfg: cfg}
	emptyIP := make(map[string]*ipBucket)
	l.perIP.Store(&emptyIP)
	emptyUser := make(map[string]*userLockout)
	l.perUserFails.Store(&emptyUser)
	return l
}

// canonicalProfile normalises an empty profile to "default" so the
// lockout bucket key matches the eventual Login handler's auth attempt.
// Lower-cases the result so case-only variations are coalesced.
func canonicalProfile(profile string) string {
	p := strings.ToLower(strings.TrimSpace(profile))
	if p == "" {
		return "default"
	}
	return p
}

// userKey returns the lockout-bucket key for a (profile, username) pair.
// Username is treated case-sensitively to match the upstream Geode
// behaviour; profile is canonicalised by canonicalProfile.
func userKey(profile, username string) string {
	return canonicalProfile(profile) + "\x00" + username
}

// Allow reports whether a login attempt from `ip` for (profile, user)
// can proceed. On reject it returns the recommended Retry-After and a
// short reason string for audit logging.
//
// Hot path: atomic.Load both maps, look up the keys, take per-bucket
// mutexes. No global lock on cache-hit traffic.
func (l *LoginLimiter) Allow(ip, profile, username string) (bool, time.Duration, string) {
	now := l.cfg.Now()

	// 1) Per-(profile, user) lockout — checked first so the per-IP
	//    bucket is not consumed by an already-locked account.
	key := userKey(profile, username)
	userMap := *l.perUserFails.Load()
	if u, ok := userMap[key]; ok {
		u.mu.Lock()
		locked := u.count >= l.cfg.FailThreshold
		if locked {
			elapsed := now.Sub(u.lastFail)
			if elapsed < l.cfg.LockoutWindow {
				retry := l.cfg.LockoutWindow - elapsed
				u.mu.Unlock()
				return false, retry, "user_locked"
			}
			// Lockout window expired. Reset the counter in place so
			// the next fail stream starts fresh; the entry is left in
			// the map (cheap COW avoidance). A future PERF item (#225)
			// adds a TTL janitor for true eviction.
			u.count = 0
			u.lastFail = time.Time{}
		}
		u.mu.Unlock()
	}

	// 2) Per-IP rate limit. Look up under atomic snapshot; if missing,
	//    COW-insert under the writer mutex.
	ipMap := *l.perIP.Load()
	bkt, ok := ipMap[ip]
	if !ok {
		bkt = l.insertIPBucket(ip, now)
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
		// One token's worth of seconds = 1/rate.
		shortfall := 1.0 - bkt.tokens
		bkt.mu.Unlock()
		retry := max(time.Duration(shortfall/l.cfg.PerIPRate*float64(time.Second)), time.Second)
		return false, retry, "ip_rate_limited"
	}
	bkt.tokens -= 1
	bkt.mu.Unlock()
	return true, 0, ""
}

// insertIPBucket COW-inserts a new bucket for ip. Returns the inserted
// bucket (or, if a concurrent caller raced us and inserted first, the
// existing bucket so we both converge on the same instance).
func (l *LoginLimiter) insertIPBucket(ip string, now time.Time) *ipBucket {
	l.perIPWriteMu.Lock()
	defer l.perIPWriteMu.Unlock()
	// Re-check under the writer mutex.
	current := *l.perIP.Load()
	if bkt, ok := current[ip]; ok {
		return bkt
	}
	bkt := &ipBucket{tokens: l.cfg.PerIPBurst, last: now}
	next := make(map[string]*ipBucket, len(current)+1)
	maps.Copy(next, current)
	next[ip] = bkt
	l.perIP.Store(&next)
	return bkt
}

// insertUserLockout COW-inserts a new userLockout for key.
func (l *LoginLimiter) insertUserLockout(key string) *userLockout {
	l.perUserWriteMu.Lock()
	defer l.perUserWriteMu.Unlock()
	current := *l.perUserFails.Load()
	if u, ok := current[key]; ok {
		return u
	}
	u := &userLockout{}
	next := make(map[string]*userLockout, len(current)+1)
	maps.Copy(next, current)
	next[key] = u
	l.perUserFails.Store(&next)
	return u
}

// NoteFail records one authentication failure against (profile, user).
// Increments the lockout counter; the FailThreshold-th call locks the
// account for LockoutWindow.
func (l *LoginLimiter) NoteFail(profile, username string) {
	now := l.cfg.Now()
	key := userKey(profile, username)
	current := *l.perUserFails.Load()
	u, ok := current[key]
	if !ok {
		u = l.insertUserLockout(key)
	}
	u.mu.Lock()
	u.count++
	u.lastFail = now
	u.mu.Unlock()
}

// NoteSuccess clears the lockout counter for (profile, user). Called on
// any 2xx login response.
//
// Implementation note: we zero the counter in-place under the
// per-bucket mutex rather than COW-deleting from the map. This avoids
// the COW cost on the success path (which is hotter than the lockout
// path) and keeps the test contract identical: a fresh Allow() after
// NoteSuccess sees count=0, not threshold. Eviction of the map entry
// itself is deferred to the TTL janitor follow-up (#225).
func (l *LoginLimiter) NoteSuccess(profile, username string) {
	key := userKey(profile, username)
	current := *l.perUserFails.Load()
	if u, ok := current[key]; ok {
		u.mu.Lock()
		u.count = 0
		u.lastFail = time.Time{}
		u.mu.Unlock()
	}
}

// WrapLoginLimit wraps next so any POST /api/v1/auth/login traffic
// flows through the limiter; everything else passes through. The
// wrapper extracts client IP, parses profile/username from the form
// body (without consuming it for the inner handler), and on a 401
// inner response calls NoteFail.
func WrapLoginLimit(l *LoginLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/auth/login" {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r, l.cfg.TrustProxyXFF)
		profile, username, err := peekLoginCreds(r)
		if err != nil {
			// Body unreadable — punt to the inner handler which will
			// reject as 400. We still apply per-IP rate-limit on the
			// path itself (using empty username) so a flood of
			// malformed POSTs is not free.
			ok, retry, reason := l.Allow(ip, "default", "")
			if !ok {
				rejectLogin(w, retry, reason)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		ok, retry, reason := l.Allow(ip, profile, username)
		if !ok {
			rejectLogin(w, retry, reason)
			emitAudit(auditEventLoginFailure,
				"user", username,
				"profile", canonicalProfile(profile),
				"reason", reason,
				"ip", ip,
			)
			return
		}

		// Wrap the response to observe status without buffering the body.
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		switch {
		case sw.status == http.StatusUnauthorized:
			l.NoteFail(profile, username)
		case sw.status >= 200 && sw.status < 300:
			l.NoteSuccess(profile, username)
		}
	})
}

// statusWriter tees the status code without altering the body.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// rejectLogin emits a 429 with Retry-After and a short JSON body.
func rejectLogin(w http.ResponseWriter, retry time.Duration, reason string) {
	if retry < time.Second {
		retry = time.Second
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(retry/time.Second)))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	body := `{"code":"rate_limited","description":"too many attempts; try again later","reason":"` + reason + `"}`
	_, _ = w.Write([]byte(body))
}

// peekLoginCreds reads the form body, parses profile + username, and
// restores the body on the request so the inner handler can re-parse
// it. Limits the read to 4096 bytes to match the genapi-emitted body
// cap on this route. Returns "" + nil error if the body is empty.
func peekLoginCreds(r *http.Request) (profile, username string, err error) {
	if r.Body == nil {
		return "", "", nil
	}
	const maxBody = 4096
	buf, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return "", "", err
	}
	if len(buf) > maxBody {
		// Oversize body; let the genapi handler's MaxBytesReader emit
		// the canonical 413 — we don't need to decide here.
		buf = buf[:maxBody]
	}
	// Restore for the inner handler.
	r.Body = io.NopCloser(bytes.NewReader(buf))

	// Form-encoded; gen/api/handlers_gen.go:1484-1488 uses r.ParseForm()
	// + r.FormValue.
	vals, perr := url.ParseQuery(string(buf))
	if perr != nil {
		// Treat as empty — the inner handler's r.ParseForm will reject.
		return "", "", nil
	}
	return vals.Get("profile"), vals.Get("username"), nil
}

// clientIP returns the best-guess remote IP for the request.
//
// S-NEW-5 (#201) hardening: X-Forwarded-For is no longer trusted by
// default. The caller passes trustProxyXFF=true only when the operator
// has explicitly opted in via the `-trust-proxy-xff` CLI flag (which
// they should only do when the binary sits behind a TLS-terminating
// reverse proxy they control and that proxy strips/normalises the
// inbound XFF header). Otherwise we fall back to the host portion of
// RemoteAddr, which matches the global per-IP limiter's
// IPSourceRemoteAddr default (cmd/server/app.go:373) and prevents an
// attacker from:
//
//   - rotating the per-IP login-limiter key (5 rps) by sending a
//     freshly-spoofed `X-Forwarded-For` on every request, and
//   - tripping per-IP lockouts against arbitrary innocent IPs
//     (DoS-by-lockout).
//
// Returns "" only if both transports are empty or unparseable.
func clientIP(r *http.Request, trustProxyXFF bool) string {
	if trustProxyXFF {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Take the first hop, trim spaces.
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			return strings.TrimSpace(xff)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
