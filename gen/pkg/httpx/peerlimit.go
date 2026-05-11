package httpx

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// IPSource selects which request attribute the global per-IP rate limiter
// keys on. RemoteAddr is the only trustworthy default; the proxy-header
// variants must only be used when the server sits behind a trusted reverse
// proxy that overwrites (not appends to) the header, otherwise a client can
// forge the key and dodge the limiter.
type IPSource int

const (
	// IPSourceRemoteAddr keys on the TCP peer address (default, safe).
	IPSourceRemoteAddr IPSource = iota
	// IPSourceXForwardedFor keys on the left-most X-Forwarded-For entry.
	IPSourceXForwardedFor
	// IPSourceXRealIP keys on the X-Real-IP header.
	IPSourceXRealIP
	// IPSourceTLSSubject keys on the verified client-cert Subject (mTLS).
	IPSourceTLSSubject
)

// ParseIPSource maps a config string to an IPSource. Unknown values fall
// back to IPSourceRemoteAddr.
func ParseIPSource(s string) IPSource {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "x-forwarded-for", "xforwardedfor", "forwarded":
		return IPSourceXForwardedFor
	case "x-real-ip", "xrealip", "realip":
		return IPSourceXRealIP
	case "tls-subject", "tlssubject", "mtls":
		return IPSourceTLSSubject
	default:
		return IPSourceRemoteAddr
	}
}

func clientKey(r *http.Request, src IPSource) string {
	switch src {
	case IPSourceXForwardedFor:
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				v = v[:i]
			}
			if k := strings.TrimSpace(v); k != "" {
				return k
			}
		}
	case IPSourceXRealIP:
		if k := strings.TrimSpace(r.Header.Get("X-Real-IP")); k != "" {
			return k
		}
	case IPSourceTLSSubject:
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			return r.TLS.PeerCertificates[0].Subject.String()
		}
	}
	// Fall back to the TCP peer address with the port stripped.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type ipEntry struct {
	b    *tokenBucket
	seen time.Time // last request time, for eviction
}

// PeerLimiter is a global token-bucket rate limiter partitioned by client
// IP (or another configured key source). It is meant to sit at the very
// outside of the handler chain as a coarse abuse ceiling underneath any
// tighter per-route or per-actor limiters. Buckets idle longer than the
// eviction TTL are swept by a background goroutine so a flood of unique
// source addresses cannot pin memory.
type PeerLimiter struct {
	rate, burst float64
	src         IPSource
	ttl         time.Duration

	mu      sync.Mutex
	entries map[string]*ipEntry

	stop chan struct{}
}

// NewPeerLimiter constructs a per-IP limiter. rate is tokens/second, burst
// the bucket size. src selects the key extractor. The returned limiter
// starts a sweeper goroutine; call Close to stop it. A rate of zero (or
// negative) is the caller's signal to skip wiring the middleware entirely;
// NewPeerLimiter still returns a usable allow-all limiter for safety.
func NewPeerLimiter(rate, burst float64, src IPSource) *PeerLimiter {
	pl := &PeerLimiter{
		rate:    rate,
		burst:   burst,
		src:     src,
		ttl:     10 * time.Minute,
		entries: make(map[string]*ipEntry),
		stop:    make(chan struct{}),
	}
	go pl.sweep()
	return pl
}

func (pl *PeerLimiter) sweep() {
	t := time.NewTicker(pl.ttl)
	defer t.Stop()
	for {
		select {
		case <-pl.stop:
			return
		case now := <-t.C:
			pl.mu.Lock()
			for k, e := range pl.entries {
				if now.Sub(e.seen) > pl.ttl {
					delete(pl.entries, k)
				}
			}
			pl.mu.Unlock()
		}
	}
}

// Close stops the background sweeper. Safe to call once.
func (pl *PeerLimiter) Close() {
	select {
	case <-pl.stop:
	default:
		close(pl.stop)
	}
}

func (pl *PeerLimiter) allow(key string) bool {
	if pl.rate <= 0 && pl.burst <= 0 {
		return true // disabled: allow-all (see NewPeerLimiter doc)
	}
	pl.mu.Lock()
	e, ok := pl.entries[key]
	if !ok {
		e = &ipEntry{b: newBucket(pl.rate, pl.burst)}
		pl.entries[key] = e
	}
	e.seen = time.Now()
	b := e.b
	pl.mu.Unlock()
	return b.allow()
}

// Middleware wraps next so every request first passes the per-IP bucket.
// On rejection it emits a 429 with Retry-After and a JSON body shaped
// {code, description, reason} -- the same envelope the generated per-route
// limiters use -- so a single client-side 429 handler covers all layers.
//
// Callers gate wiring on rate>0 && burst>0 (a rate of zero is the
// "disabled" signal); Middleware itself does not self-disable so tests can
// drive a zero-refill bucket.
func (pl *PeerLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if pl.allow(clientKey(r, pl.src)) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds(pl.rate)))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"code":"rate_limited","description":"too many requests; slow down","reason":"per_ip"}`))
	})
}

func retryAfterSeconds(rate float64) int {
	if rate <= 0 {
		return 1
	}
	s := int(1.0/rate + 0.999)
	if s < 1 {
		s = 1
	}
	return s
}
