package httpx

import (
	"context"
	"crypto/tls"
	"encoding/json/v2"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/obsx"
)

// Config holds runtime server settings.
type Config struct {
	Bind           string
	TLSCert        string
	TLSKey         string
	MTLSCA         string
	ReadHeader     time.Duration
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
	IdleTimeout    time.Duration
	MaxHeaderBytes int
	MaxBodyBytes   int64
	CORSEnabled    bool
	CORSOrigins    []string
}

type tokenBucket struct {
	mu          sync.Mutex
	tokens      float64
	last        time.Time
	rate, burst float64
}

func newBucket(rate, burst float64) *tokenBucket {
	return &tokenBucket{tokens: burst, last: time.Now(), rate: rate, burst: burst}
}
func (t *tokenBucket) allow() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	dt := now.Sub(t.last).Seconds()
	t.tokens += dt * t.rate
	if t.tokens > t.burst {
		t.tokens = t.burst
	}
	t.last = now
	if t.tokens >= 1 {
		t.tokens -= 1
		return true
	}
	return false
}
func (t *tokenBucket) snapshot() (limit int, remaining int, reset time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	limit = int(t.burst)
	remaining = int(t.tokens)
	reset = time.Now().Add(time.Second)
	return limit, remaining, reset
}

// WrapHandler wraps h with security headers, CORS, and body size limiting per cfg.
// Use this when managing the http.Server directly instead of calling Serve.
func WrapHandler(cfg Config, h http.Handler) http.Handler {
	hs := headers(h, cfg)
	return limitBody(cfg.MaxBodyBytes, hs)
}

// Serve starts an HTTP server with TLS1.3-only and sane defaults.
func Serve(ctx context.Context, cfg Config, mux *http.ServeMux) error {
	// Chain: headers (incl CORS) -> body limiter -> request-id logging
	hs := headers(mux, cfg)
	lh := limitBody(cfg.MaxBodyBytes, hs)
	logged := obsx.Middleware(lh)
	ts := &http.Server{
		Addr:              cfg.Bind,
		Handler:           logged,
		ReadHeaderTimeout: cfg.ReadHeader,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    cfg.MaxHeaderBytes,
	}
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		ts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13}
		ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.Bind)
		if err != nil {
			return err
		}
		tlsLn := tls.NewListener(ln, ts.TLSConfig)
		go func() { <-ctx.Done(); _ = ts.Close() }()
		return ts.ServeTLS(tlsLn, cfg.TLSCert, cfg.TLSKey)
	}
	go func() { <-ctx.Done(); _ = ts.Close() }()
	return ts.ListenAndServe()
}

// DecodeJSON reads JSON from r into v, rejecting unknown fields.
func DecodeJSON(r io.Reader, v any) error {
	return json.UnmarshalRead(r, v, json.RejectUnknownMembers(true))
}

// headers applies HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and optional CORS.
func headers(next http.Handler, cfg Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if cfg.CORSEnabled && len(cfg.CORSOrigins) > 0 {
			orig := r.Header.Get("Origin")
			if orig != "" {
				allowed := false
				for _, o := range cfg.CORSOrigins {
					if o == "*" || strings.EqualFold(o, orig) {
						allowed = true
						break
					}
				}
				if allowed {
					w.Header().Set("Access-Control-Allow-Origin", orig)
					w.Header().Add("Vary", "Origin")
					// Preflight handling (OPTIONS)
					if r.Method == http.MethodOptions {
						w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
						reqHeaders := r.Header.Get("Access-Control-Request-Headers")
						if reqHeaders == "" {
							reqHeaders = "Content-Type, Authorization"
						}
						w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
						w.WriteHeader(http.StatusNoContent)
						return
					}
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func limitBody(max int64, next http.Handler) http.Handler {
	if max <= 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > 0 && r.ContentLength > max {
			http.Error(w, ErrBodyTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, max)
		next.ServeHTTP(w, r)
	})
}

// RouteLimiter applies a token bucket per route and sets X-RateLimit-* headers.
func RouteLimiter(rate, burst float64, next http.Handler) http.Handler {
	b := newBucket(rate, burst)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lim, rem, reset := b.snapshot()
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(lim))
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(rem))
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
		if !b.allow() {
			http.Error(w, ErrRateLimited.Error(), http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Mux returns a new ServeMux and a helper to mount JSON routes with rate limits.
type Mux struct{ *http.ServeMux }

// NewMux constructs a new mux wrapper.
func NewMux() *Mux { return &Mux{ServeMux: http.NewServeMux()} }

// HandleJSON registers a JSON route with optional rate limiting.
func (m *Mux) HandleJSON(path, method string, h func(http.ResponseWriter, *http.Request), rate, burst float64) {
	hnd := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	})
	var final http.Handler = hnd
	if rate > 0 && burst > 0 {
		final = RouteLimiter(rate, burst, final)
	}
	m.Handle(path, final)
}
