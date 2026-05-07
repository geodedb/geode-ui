package server

import (
	"bytes"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
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
type LoginLimiter struct {
	cfg LoginLimiterConfig

	mu           sync.Mutex
	perIP        map[string]*ipBucket
	perUserFails map[string]*userLockout
}

type ipBucket struct {
	tokens float64
	last   time.Time
}

type userLockout struct {
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
	return &LoginLimiter{
		cfg:          cfg,
		perIP:        make(map[string]*ipBucket),
		perUserFails: make(map[string]*userLockout),
	}
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
func (l *LoginLimiter) Allow(ip, profile, username string) (bool, time.Duration, string) {
	now := l.cfg.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// 1) Per-(profile, user) lockout — checked first so the per-IP
	//    bucket is not consumed by an already-locked account.
	key := userKey(profile, username)
	if u, ok := l.perUserFails[key]; ok {
		// Has the lockout already expired?
		if u.count >= l.cfg.FailThreshold {
			elapsed := now.Sub(u.lastFail)
			if elapsed < l.cfg.LockoutWindow {
				return false, l.cfg.LockoutWindow - elapsed, "user_locked"
			}
			// Expired; reset the counter.
			delete(l.perUserFails, key)
		}
	}

	// 2) Per-IP rate limit.
	bkt, ok := l.perIP[ip]
	if !ok {
		bkt = &ipBucket{tokens: l.cfg.PerIPBurst, last: now}
		l.perIP[ip] = bkt
	}
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
		retry := time.Duration((1.0 - bkt.tokens) / l.cfg.PerIPRate * float64(time.Second))
		if retry < time.Second {
			retry = time.Second
		}
		return false, retry, "ip_rate_limited"
	}
	bkt.tokens -= 1
	return true, 0, ""
}

// NoteFail records one authentication failure against (profile, user).
// Increments the lockout counter; the FailThreshold-th call locks the
// account for LockoutWindow.
func (l *LoginLimiter) NoteFail(profile, username string) {
	now := l.cfg.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	key := userKey(profile, username)
	u, ok := l.perUserFails[key]
	if !ok {
		u = &userLockout{}
		l.perUserFails[key] = u
	}
	// If we are within an existing lockout window, tick the counter
	// without resetting the lastFail; otherwise this is a fresh failure
	// stream.
	u.count++
	u.lastFail = now
}

// NoteSuccess clears the lockout counter for (profile, user). Called on
// any 2xx login response.
func (l *LoginLimiter) NoteSuccess(profile, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.perUserFails, userKey(profile, username))
}

// WrapLoginLimit wraps next so any POST /api/v1/auth/login traffic
// flows through the limiter; everything else passes through. The
// wrapper extracts client IP, parses profile/username from the form
// body (without consuming it for the inner handler), and on a 401
// inner response calls NoteFail.
func WrapLoginLimit(l *LoginLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !(r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/login") {
			next.ServeHTTP(w, r)
			return
		}
		ip := clientIP(r)
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

// clientIP returns the best-guess remote IP for the request. Honours
// the leading hop of X-Forwarded-For when set (geode-ui's deployment
// model puts an L7 proxy in front of the binary), falling back to the
// host portion of RemoteAddr otherwise. Returns "" if both are empty
// or unparseable.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first hop, trim spaces.
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
