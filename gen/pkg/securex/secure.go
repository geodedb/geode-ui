package securex

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/gen"
)

// defaultHMACBodyLimit bounds the number of bytes APIKeyAuth will read from
// a request body when computing the canonical HMAC signature. Before
// PERF-0012 the body was io.ReadAll'd with no cap, which let an attacker
// tie up memory by sending a large body just before the signature check.
// Callers who need a different limit can use APIKeyAuthWithLimit directly.
const defaultHMACBodyLimit int64 = 10 * 1024 * 1024 // 10 MiB

// APIKeyAuth verifies Authorization: Bearer <hmac-hex> using a canonical request
// signature bound to method/path/body/nonce/timestamp and secret.
// It enforces a time window and replay protection via the seen map.
//
// The request body is streamed through the hash via io.LimitReader with
// defaultHMACBodyLimit so that a single oversized request cannot exhaust
// server memory. See APIKeyAuthWithLimit for the explicit-limit variant.
func APIKeyAuth(r *http.Request, secret []byte, window time.Duration, seen *sync.Map) error {
	return APIKeyAuthWithLimit(r, secret, window, seen, defaultHMACBodyLimit)
}

// APIKeyAuthWithLimit is the explicit-limit variant of APIKeyAuth. The
// maxBodyBytes parameter caps the number of bytes that will be read from
// r.Body when computing the canonical signature. A value of 0 resolves to
// defaultHMACBodyLimit. A body strictly larger than maxBodyBytes is
// rejected with an error that wraps ErrBodyTooLarge; callers can inspect
// via errors.Is.
func APIKeyAuthWithLimit(r *http.Request, secret []byte, window time.Duration, seen *sync.Map, maxBodyBytes int64) error {
	if maxBodyBytes <= 0 {
		maxBodyBytes = defaultHMACBodyLimit
	}
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ErrAuthFailed
	}
	parts := strings.Fields(auth)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ErrAuthFailed
	}
	tok := parts[1]
	nonce := r.Header.Get("X-Nonce")
	ts := r.Header.Get("X-Timestamp")
	if nonce == "" || ts == "" {
		return ErrAuthFailed
	}
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrAuthFailed
	}
	when := time.Unix(sec, 0)
	if d := time.Since(when); d > window || d < -window {
		return ErrAuthFailed
	}
	msg, replayKey, err := canonicalRequestMACInputWithLimit(r, nonce, ts, maxBodyBytes)
	if err != nil {
		if errors.Is(err, ErrBodyTooLarge) {
			return err
		}
		return ErrAuthFailed
	}
	exp := computeHMAC(msg, secret)
	if !constTimeEq(tok, exp) {
		return ErrAuthFailed
	}
	if _, loaded := seen.LoadOrStore(replayKey, time.Now().Add(window)); loaded {
		return ErrAuthFailed
	}
	return nil
}

// SignAPIKeyRequest signs r using the same canonical request rules enforced by
// APIKeyAuth. It sets Authorization, X-Nonce, and X-Timestamp on the request.
func SignAPIKeyRequest(r *http.Request, secret []byte, now time.Time) error {
	nonce, err := randomNonce()
	if err != nil {
		return err
	}
	return SignAPIKeyRequestWithValues(r, secret, nonce, strconv.FormatInt(now.Unix(), 10))
}

// SignAPIKeyRequestWithValues signs r with explicit nonce and timestamp values.
// This is useful for deterministic tests and for flows that need to precompute
// signed WebSocket auth material.
func SignAPIKeyRequestWithValues(r *http.Request, secret []byte, nonce, ts string) error {
	if r == nil {
		return ErrAuthFailed
	}
	msg, _, err := canonicalRequestMACInput(r, nonce, ts)
	if err != nil {
		return err
	}
	r.Header.Set("Authorization", "Bearer "+computeHMAC(msg, secret))
	r.Header.Set("X-Nonce", nonce)
	r.Header.Set("X-Timestamp", ts)
	return nil
}

// RequestAuthPolicy controls which alternate auth transports are accepted when
// a request cannot set normal Authorization headers directly.
type RequestAuthPolicy struct {
	AllowAuthorizationHeader  bool
	AllowSubprotocolBearer    bool
	AllowSubprotocolSignature bool
	AllowQueryBearer          bool
	AllowQuerySignature       bool
}

// DefaultRequestAuthPolicy is the hardened default used by generated servers.
func DefaultRequestAuthPolicy() RequestAuthPolicy {
	return RequestAuthPolicy{
		AllowAuthorizationHeader:  true,
		AllowSubprotocolBearer:    true,
		AllowSubprotocolSignature: true,
		AllowQueryBearer:          false,
		AllowQuerySignature:       false,
	}
}

// UnsafeQueryAuthPolicy reproduces the legacy permissive query-token behavior.
func UnsafeQueryAuthPolicy() RequestAuthPolicy {
	policy := DefaultRequestAuthPolicy()
	policy.AllowQueryBearer = true
	policy.AllowQuerySignature = true
	return policy
}

// RequestWithAuth applies the hardened default request auth policy.
func RequestWithAuth(r *http.Request) *http.Request {
	return RequestWithAuthPolicy(r, DefaultRequestAuthPolicy())
}

// RequestWithQueryAuth preserves the legacy permissive behavior. Prefer
// RequestWithAuth or RequestWithAuthPolicy in new code.
func RequestWithQueryAuth(r *http.Request) *http.Request {
	return RequestWithAuthPolicy(r, UnsafeQueryAuthPolicy())
}

// RequestWithAuthPolicy clones r and fills auth headers from the configured
// transport sources, including websocket subprotocol auth markers when browser
// clients cannot set custom headers during the upgrade.
func RequestWithAuthPolicy(r *http.Request, policy RequestAuthPolicy) *http.Request {
	if r == nil || r.URL == nil {
		return r
	}
	q := r.URL.Query()
	protoAuth := websocketProtocolAuth(r.Header.Values("Sec-WebSocket-Protocol"))
	var clone *http.Request
	setHeader := func(key, val string) {
		if strings.TrimSpace(val) == "" {
			return
		}
		if clone == nil {
			clone = r.Clone(r.Context())
		}
		clone.Header.Set(key, val)
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" {
		if policy.AllowSubprotocolBearer {
			if tok := strings.TrimSpace(protoAuth.bearerToken); tok != "" {
				setHeader("Authorization", "Bearer "+tok)
			}
		}
		if strings.TrimSpace(cloneHeaderValue(clone, r, "Authorization")) == "" && policy.AllowSubprotocolSignature {
			if sig := strings.TrimSpace(protoAuth.signature); sig != "" {
				setHeader("Authorization", "Bearer "+sig)
			}
		}
		if strings.TrimSpace(cloneHeaderValue(clone, r, "Authorization")) == "" && policy.AllowQueryBearer {
			if tok := strings.TrimSpace(q.Get("access_token")); tok != "" {
				setHeader("Authorization", "Bearer "+tok)
			}
		}
		if strings.TrimSpace(cloneHeaderValue(clone, r, "Authorization")) == "" && policy.AllowQuerySignature {
			if sig := strings.TrimSpace(q.Get("sig")); sig != "" {
				setHeader("Authorization", "Bearer "+sig)
			}
		}
	} else if !policy.AllowAuthorizationHeader {
		if clone == nil {
			clone = r.Clone(r.Context())
		}
		clone.Header.Del("Authorization")
	}
	if strings.TrimSpace(cloneHeaderValue(clone, r, "X-Nonce")) == "" {
		if policy.AllowSubprotocolSignature && protoAuth.nonce != "" {
			setHeader("X-Nonce", protoAuth.nonce)
		} else if policy.AllowQuerySignature {
			setHeader("X-Nonce", q.Get("nonce"))
		}
	}
	if strings.TrimSpace(cloneHeaderValue(clone, r, "X-Timestamp")) == "" {
		if policy.AllowSubprotocolSignature && protoAuth.timestamp != "" {
			setHeader("X-Timestamp", protoAuth.timestamp)
		} else if policy.AllowQuerySignature {
			setHeader("X-Timestamp", q.Get("ts"))
		}
	}
	if clone != nil {
		return clone
	}
	return r
}

func cloneHeaderValue(clone, original *http.Request, key string) string {
	if clone != nil {
		return clone.Header.Get(key)
	}
	if original == nil {
		return ""
	}
	return original.Header.Get(key)
}

type websocketProtocolAuthData struct {
	bearerToken string
	signature   string
	nonce       string
	timestamp   string
}

func websocketProtocolAuth(values []string) websocketProtocolAuthData {
	var auth websocketProtocolAuthData
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part == "" || !strings.HasPrefix(part, "genapi.auth.") {
				continue
			}
			rest := strings.TrimPrefix(part, "genapi.auth.")
			kind, encoded, ok := strings.Cut(rest, ".")
			if !ok || encoded == "" {
				continue
			}
			decoded, err := base64.RawURLEncoding.DecodeString(encoded)
			if err != nil {
				continue
			}
			switch kind {
			case "bearer":
				if auth.bearerToken == "" {
					auth.bearerToken = string(decoded)
				}
			case "sig":
				if auth.signature == "" {
					auth.signature = string(decoded)
				}
			case "nonce":
				if auth.nonce == "" {
					auth.nonce = string(decoded)
				}
			case "ts":
				if auth.timestamp == "" {
					auth.timestamp = string(decoded)
				}
			}
		}
	}
	return auth
}

// bodyBufPool recycles *bytes.Buffer instances used to re-stage the request
// body after streaming it through the HMAC hash. Reusing the buffer across
// calls keeps allocation O(1) per request independent of body size
// (modulo the pool capacity growth path).
//
//nolint:gochecknoglobals // sync.Pool is the idiomatic lifetime boundary here
var bodyBufPool = sync.Pool{
	New: func() any { return new(bytes.Buffer) },
}

// canonicalRequestMACInput is the back-compat entry point for callers that
// do not need a custom body limit. It delegates to the limit-aware path
// with defaultHMACBodyLimit so that the legacy helper is no longer
// unbounded. (PERF-0012.)
func canonicalRequestMACInput(r *http.Request, nonce, ts string) (msg string, replayKey string, err error) {
	return canonicalRequestMACInputWithLimit(r, nonce, ts, defaultHMACBodyLimit)
}

// canonicalRequestMACInputWithLimit assembles the canonical HMAC input and
// replay key for r, bounding the body read at maxBodyBytes bytes. A body
// that exceeds the limit produces an error that wraps ErrBodyTooLarge.
func canonicalRequestMACInputWithLimit(r *http.Request, nonce, ts string, maxBodyBytes int64) (msg string, replayKey string, err error) {
	bodyHash, err := requestBodySHA256HexWithLimit(r, maxBodyBytes)
	if err != nil {
		return "", "", err
	}
	path := r.URL.EscapedPath()
	if path == "" {
		path = r.URL.Path
	}
	method := strings.ToUpper(strings.TrimSpace(r.Method))
	msg = method + "|" + path + "|" + bodyHash + "|" + nonce + "|" + ts
	replayKey = nonce + "|" + ts + "|" + method + "|" + path + "|" + bodyHash
	return msg, replayKey, nil
}

// requestBodySHA256HexWithLimit streams r.Body through sha256 via an
// io.LimitReader bounded at maxBodyBytes. The hashed bytes are also
// copied into a pooled *bytes.Buffer so that r.Body can be re-read by
// downstream handlers. If the body actually contains more than
// maxBodyBytes bytes, returns an error wrapping ErrBodyTooLarge without
// buffering the rest.
//
// IMPORTANT: the previous io.ReadAll(r.Body) implementation was the
// PERF-0012 hot path. Leaving any unbounded reader here would defeat
// the fix.
func requestBodySHA256HexWithLimit(r *http.Request, maxBodyBytes int64) (string, error) {
	if r == nil || r.Body == nil {
		sum := sha256.Sum256(nil)
		return hex.EncodeToString(sum[:]), nil
	}
	if maxBodyBytes <= 0 {
		maxBodyBytes = defaultHMACBodyLimit
	}
	h := sha256.New()
	buf := bodyBufPool.Get().(*bytes.Buffer)
	buf.Reset()

	// Read at most maxBodyBytes+1 so we can distinguish "exactly at limit"
	// (acceptable) from "over the limit" (reject).
	limited := io.LimitReader(r.Body, maxBodyBytes+1)
	// Tee into both the hash and the rewrap buffer in a single streaming
	// pass; zero-copy beyond the hash/buffer capacity growth.
	n, err := io.Copy(io.MultiWriter(h, buf), limited)
	if err != nil {
		bodyBufPool.Put(buf)
		return "", err
	}
	_ = r.Body.Close()
	if n > maxBodyBytes {
		bodyBufPool.Put(buf)
		return "", fmt.Errorf("%w: body exceeds %d bytes", ErrBodyTooLarge, maxBodyBytes)
	}

	// Rewrap the body so downstream handlers see the same bytes. The
	// closer returns the buffer to the pool once the body is fully
	// consumed and closed.
	r.Body = &pooledBuffer{Reader: bytes.NewReader(buf.Bytes()), buf: buf}

	sum := h.Sum(nil)
	return hex.EncodeToString(sum), nil
}

// pooledBuffer wraps a bytes.Reader over a pooled *bytes.Buffer. Closing
// the wrapper releases the underlying buffer back to the pool. We use a
// struct with embedded *bytes.Reader so Read/Close both satisfy io.ReadCloser.
type pooledBuffer struct {
	*bytes.Reader
	buf *bytes.Buffer
}

// Close returns the underlying buffer to the pool. Safe to call at most
// once; subsequent calls are no-ops.
func (p *pooledBuffer) Close() error {
	if p.buf != nil {
		p.buf.Reset()
		bodyBufPool.Put(p.buf)
		p.buf = nil
	}
	return nil
}

func computeHMAC(msg string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(msg))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func constTimeEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	x := byte(0)
	for i := 0; i < len(a); i++ {
		x |= a[i] ^ b[i]
	}
	return x == 0
}

// StartNonceGC starts a GC loop to remove expired nonces stored by APIKeyAuth.
func StartNonceGC(seen *sync.Map, interval time.Duration) chan struct{} {
	stop := make(chan struct{})
	gen.SafeLoop("nonce-gc", stop, func(stop <-chan struct{}) {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				now := time.Now()
				seen.Range(func(k, v any) bool {
					if exp, ok := v.(time.Time); ok && now.After(exp) {
						seen.Delete(k)
					}
					return true
				})
			case <-stop:
				return
			}
		}
	})
	return stop
}

// Bucket provides a simple token bucket limiter for per-route/tool scoping.
type Bucket struct {
	mu          sync.Mutex
	tokens      float64
	last        time.Time
	rate, burst float64
}

// NewBucket creates a new token bucket with the provided rate and burst.
func NewBucket(rate, burst float64) *Bucket {
	return &Bucket{tokens: burst, last: time.Now(), rate: rate, burst: burst}
}

// Allow returns true if a token is available and consumes one.
func (b *Bucket) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	dt := now.Sub(b.last).Seconds()
	b.tokens += dt * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}

// Snapshot returns an approximate (limit, remaining, resetTime) for headers.
func (b *Bucket) Snapshot() (int, int, time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	limit := int(b.burst)
	remaining := int(b.tokens)
	reset := time.Now().Add(time.Second)
	return limit, remaining, reset
}

// SetRateHeaders sets basic rate-limit headers on the response.
func SetRateHeaders(w http.ResponseWriter, limit, remaining int, reset time.Time) {
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
}

// ErrJWTUnsupported indicates VerifyJWT cannot handle the given algorithm/token.
var ErrJWTUnsupported = errors.New("securex: jwt algorithm or token unsupported")

// JWTVerifyOptions are optional constraints for issuer/audience claim checks.
type JWTVerifyOptions struct {
	Issuer   string
	Audience string
}

// VerifyJWT verifies a compact JWS (HS256) with the provided secret.
// Returns ErrJWTUnsupported if algorithm is not HS256 or token malformed.
func VerifyJWT(token string, secret []byte) error {
	return VerifyJWTWithOptions(token, secret, JWTVerifyOptions{})
}

// VerifyJWTWithOptions verifies a compact JWS (HS256) with the provided secret
// and enforces optional issuer/audience checks when configured.
func VerifyJWTWithOptions(token string, secret []byte, opts JWTVerifyOptions) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ErrJWTUnsupported
	}
	headB64, payloadB64, sigB64 := parts[0], parts[1], parts[2]
	// decode header to check alg
	headJSON, err := base64.RawURLEncoding.DecodeString(headB64)
	if err != nil {
		return ErrJWTUnsupported
	}
	var hdr struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headJSON, &hdr); err != nil {
		return ErrJWTUnsupported
	}
	if hdr.Alg != "HS256" {
		return ErrJWTUnsupported
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return ErrJWTUnsupported
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(headB64 + "." + payloadB64))
	if !hmac.Equal(mac.Sum(nil), sig) {
		return ErrAuthFailed
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return ErrJWTUnsupported
	}
	var claims map[string]any
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return ErrJWTUnsupported
	}
	now := time.Now()
	// RFC 7519 clock-skew tolerance.
	const skew = 60 * time.Second

	if raw, ok := claims["exp"]; ok {
		exp, ok := parseNumericDate(raw)
		if !ok {
			return ErrAuthFailed
		}
		if now.After(exp.Add(skew)) {
			return ErrAuthFailed
		}
	}
	if raw, ok := claims["nbf"]; ok {
		nbf, ok := parseNumericDate(raw)
		if !ok {
			return ErrAuthFailed
		}
		if now.Before(nbf.Add(-skew)) {
			return ErrAuthFailed
		}
	}
	if raw, ok := claims["iat"]; ok {
		iat, ok := parseNumericDate(raw)
		if !ok {
			return ErrAuthFailed
		}
		if now.Before(iat.Add(-skew)) {
			return ErrAuthFailed
		}
		if rawExp, hasExp := claims["exp"]; hasExp {
			exp, ok := parseNumericDate(rawExp)
			if !ok || iat.After(exp.Add(skew)) {
				return ErrAuthFailed
			}
		}
	}
	if iss := strings.TrimSpace(opts.Issuer); iss != "" {
		rawISS, ok := claims["iss"]
		if !ok {
			return ErrAuthFailed
		}
		issClaim, ok := rawISS.(string)
		if !ok || strings.TrimSpace(issClaim) != iss {
			return ErrAuthFailed
		}
	}
	if aud := strings.TrimSpace(opts.Audience); aud != "" {
		rawAUD, ok := claims["aud"]
		if !ok || !claimHasAudience(rawAUD, aud) {
			return ErrAuthFailed
		}
	}
	return nil
}

func claimHasAudience(raw any, expected string) bool {
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v) == expected
	case []any:
		for _, item := range v {
			s, ok := item.(string)
			if ok && strings.TrimSpace(s) == expected {
				return true
			}
		}
	}
	return false
}

func parseNumericDate(v any) (time.Time, bool) {
	switch x := v.(type) {
	case float64:
		return time.Unix(int64(x), 0), true
	case int64:
		return time.Unix(x, 0), true
	case int:
		return time.Unix(int64(x), 0), true
	default:
		return time.Time{}, false
	}
}
