package httpx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestPeerLimiter_ThrottlesPerIP(t *testing.T) {
	pl := NewPeerLimiter(0, 2, IPSourceRemoteAddr) // 2 tokens, no refill
	defer pl.Close()
	h := pl.Middleware(nopHandler)

	count := func(addr string) (ok, throttled int) {
		for range 5 {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			r.RemoteAddr = addr
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			switch w.Code {
			case http.StatusOK:
				ok++
			case http.StatusTooManyRequests:
				throttled++
			default:
				t.Fatalf("unexpected status %d", w.Code)
			}
		}
		return
	}

	okA, thrA := count("10.0.0.1:1111")
	if okA != 2 || thrA != 3 {
		t.Fatalf("IP A: ok=%d throttled=%d, want 2/3", okA, thrA)
	}
	// A different IP has its own bucket.
	okB, thrB := count("10.0.0.2:2222")
	if okB != 2 || thrB != 3 {
		t.Fatalf("IP B: ok=%d throttled=%d, want 2/3", okB, thrB)
	}
}

func TestPeerLimiter_429Body(t *testing.T) {
	pl := NewPeerLimiter(0, 1, IPSourceRemoteAddr)
	defer pl.Close()
	h := pl.Middleware(nopHandler)
	do := func() *httptest.ResponseRecorder {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		r.RemoteAddr = "9.9.9.9:1000"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	_ = do() // consume the one token
	w := do()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	var body struct {
		Code        string `json:"code"`
		Description string `json:"description"`
		Reason      string `json:"reason"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("429 body not JSON: %v (%s)", err, w.Body.String())
	}
	if body.Code != "rate_limited" || body.Reason == "" || body.Description == "" {
		t.Fatalf("429 body shape wrong: %+v", body)
	}
}

func TestPeerLimiter_DisabledWhenRateZero(t *testing.T) {
	pl := NewPeerLimiter(0, 0, IPSourceRemoteAddr)
	defer pl.Close()
	h := pl.Middleware(nopHandler)
	for range 100 {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		r.RemoteAddr = "1.2.3.4:5"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("disabled limiter must allow all, got %d", w.Code)
		}
	}
}

func TestPeerLimiter_XForwardedForKey(t *testing.T) {
	pl := NewPeerLimiter(0, 1, IPSourceXForwardedFor)
	defer pl.Close()
	h := pl.Middleware(nopHandler)
	hit := func(xff string) int {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		r.RemoteAddr = "10.0.0.99:1" // same TCP peer for all
		r.Header.Set("X-Forwarded-For", xff)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if c := hit("203.0.113.5, 10.0.0.99"); c != http.StatusOK {
		t.Fatalf("first XFF request: %d", c)
	}
	if c := hit("203.0.113.5"); c != http.StatusTooManyRequests {
		t.Fatalf("second request same XFF should throttle: %d", c)
	}
	if c := hit("203.0.113.6"); c != http.StatusOK {
		t.Fatalf("different XFF should have own bucket: %d", c)
	}
}

func TestParseIPSource(t *testing.T) {
	cases := map[string]IPSource{
		"":                IPSourceRemoteAddr,
		"remote_addr":     IPSourceRemoteAddr,
		"x-forwarded-for": IPSourceXForwardedFor,
		"X-Real-IP":       IPSourceXRealIP,
		"tls-subject":     IPSourceTLSSubject,
		"garbage":         IPSourceRemoteAddr,
	}
	for in, want := range cases {
		if got := ParseIPSource(in); got != want {
			t.Errorf("ParseIPSource(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestPeerLimiter_ConcurrentSafe(t *testing.T) {
	pl := NewPeerLimiter(10000, 10000, IPSourceRemoteAddr)
	defer pl.Close()
	h := pl.Middleware(nopHandler)
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			r.RemoteAddr = "10.0.0." + string(rune('0'+i%10)) + ":1"
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
		})
	}
	wg.Wait()
}
