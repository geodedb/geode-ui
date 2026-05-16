package securex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestDefaultHMACBodyLimit_Is1MiB pins the in-memory cap at exactly 1 MiB
// (PERF #171 Option B). The cap is the boundary above which a body is
// rejected with HTTP 413 rather than buffered for replay. If the constant
// changes, the documentation in the closure commits (gen/pkg/securex
// regenerated copy) goes stale; bump deliberately and update the
// PERF_GAP_ANALYSIS row to match.
func TestDefaultHMACBodyLimit_Is1MiB(t *testing.T) {
	const want int64 = 1 << 20 // 1 MiB
	if defaultHMACBodyLimit != want {
		t.Fatalf("defaultHMACBodyLimit = %d, want %d (1 MiB)", defaultHMACBodyLimit, want)
	}
}

// TestAPIKeyAuthHTTP_Below1MiB_Authenticates proves the happy path: a body
// at the boundary minus 1 byte is signed and accepted without producing
// a 413 envelope on the wire.
func TestAPIKeyAuthHTTP_Below1MiB_Authenticates(t *testing.T) {
	secret := []byte("hmac-413-test-secret")
	var seen sync.Map
	body := bytes.Repeat([]byte("a"), int(defaultHMACBodyLimit)-1)
	r := signedReqFor413(secret, body)
	w := httptest.NewRecorder()

	if !APIKeyAuthHTTP(w, r, secret, 5*time.Minute, &seen) {
		t.Fatalf("expected APIKeyAuthHTTP to succeed for sub-cap body, got status %d", w.Code)
	}
	// Body must still be re-readable downstream.
	got := make([]byte, len(body))
	n, _ := r.Body.Read(got)
	if n != len(body) {
		t.Fatalf("downstream body re-read got %d bytes, want %d", n, len(body))
	}
}

// TestAPIKeyAuthHTTP_AtLimitPlusOne_Rejects413 is the core PERF #171
// assertion: a body of exactly defaultHMACBodyLimit + 1 bytes is rejected
// with HTTP 413 and a JSON envelope carrying error_code = 413. No replay
// machinery (in-memory chunk + spilled file) is engaged; the request dies
// at the boundary instead. This is "sign-or-413" — the simpler of the two
// design options.
func TestAPIKeyAuthHTTP_AtLimitPlusOne_Rejects413(t *testing.T) {
	secret := []byte("hmac-413-test-secret")
	var seen sync.Map
	body := bytes.Repeat([]byte("b"), int(defaultHMACBodyLimit)+1)
	r := signedReqFor413(secret, body)
	w := httptest.NewRecorder()

	if APIKeyAuthHTTP(w, r, secret, 5*time.Minute, &seen) {
		t.Fatalf("expected APIKeyAuthHTTP to reject body of size %d, but it returned true", len(body))
	}
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusRequestEntityTooLarge)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var env map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("response body not JSON: %v\nraw: %s", err, w.Body.String())
	}
	if code, ok := env["error_code"]; !ok {
		t.Fatalf("envelope missing error_code field: %v", env)
	} else {
		// Accept either number (float64 via json) or numeric string.
		switch v := code.(type) {
		case float64:
			if int(v) != http.StatusRequestEntityTooLarge {
				t.Fatalf("error_code = %v, want %d", v, http.StatusRequestEntityTooLarge)
			}
		case string:
			if v != strconv.Itoa(http.StatusRequestEntityTooLarge) {
				t.Fatalf("error_code = %q, want %q", v, strconv.Itoa(http.StatusRequestEntityTooLarge))
			}
		default:
			t.Fatalf("error_code wrong type %T: %v", code, code)
		}
	}
	if errMsg, _ := env["error"].(string); !strings.Contains(errMsg, "body") {
		t.Fatalf("error field %q does not mention body", errMsg)
	}
}

// TestAPIKeyAuthHTTP_AuthFailureReturns401 proves that an HMAC mismatch
// (e.g. wrong secret) is rejected with HTTP 401, not 413. This keeps 413
// reserved for the body-size condition.
func TestAPIKeyAuthHTTP_AuthFailureReturns401(t *testing.T) {
	secret := []byte("hmac-413-test-secret")
	var seen sync.Map
	body := []byte(`{"hi":"there"}`)
	r := signedReqFor413(secret, body)
	// Tamper signature.
	r.Header.Set("Authorization", "Bearer 00")
	w := httptest.NewRecorder()

	if APIKeyAuthHTTP(w, r, secret, 5*time.Minute, &seen) {
		t.Fatalf("expected APIKeyAuthHTTP to reject tampered signature")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// TestAPIKeyAuthWithLimit_ExactLimitPlusOne pins the boundary semantics
// at the package-level function: a body of defaultHMACBodyLimit+1 bytes
// returns ErrBodyTooLarge through the limit-aware path that uses the
// default constant.
func TestAPIKeyAuthWithLimit_ExactLimitPlusOne(t *testing.T) {
	secret := []byte("hmac-413-test-secret")
	var seen sync.Map
	body := bytes.Repeat([]byte("c"), int(defaultHMACBodyLimit)+1)
	r := signedReqFor413(secret, body)
	err := APIKeyAuthWithLimit(r, secret, 5*time.Minute, &seen, defaultHMACBodyLimit)
	if err == nil {
		t.Fatalf("expected ErrBodyTooLarge for body of %d bytes", len(body))
	}
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("expected ErrBodyTooLarge, got %v", err)
	}
}

// signedReqFor413 constructs a properly-signed HMAC request with the
// supplied body. Uses the bench-test helper convention (bytes.Reader for
// no extra allocation) but lives here so the unit-test compilation unit
// is self-contained.
func signedReqFor413(secret []byte, body []byte) *http.Request {
	bodyHash := sha256.Sum256(body)
	hashHex := hex.EncodeToString(bodyHash[:])
	nonce := "nonce-413-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	msg := "POST|/sign|" + hashHex + "|" + nonce + "|" + ts
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	tok := hex.EncodeToString(mac.Sum(nil))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/sign", bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("X-Nonce", nonce)
	r.Header.Set("X-Timestamp", ts)
	return r
}
