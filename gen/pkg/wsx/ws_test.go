package wsx

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"unicode/utf8"
)

func testWebSocketKey() string {
	return base64.StdEncoding.EncodeToString([]byte("0123456789ABCDEF"))
}

func maskPayload(p []byte, m []byte) []byte {
	out := make([]byte, len(p))
	for i := range p {
		out[i] = p[i] ^ m[i%4]
	}
	return out
}

func TestWS_ReadMessage_Fragmentation_UTF8_PingPong(t *testing.T) {
	// Build two fragments: text "hi" split in two frames
	var buf bytes.Buffer
	bw := bufio.NewWriter(&buf)
	mask := []byte{1, 2, 3, 4}
	// first fragment (FIN=0, opcode=1)
	_ = bw.WriteByte(0x01)
	_ = bw.WriteByte(0x80 | 1)
	_, _ = bw.Write(mask)
	_, _ = bw.Write(maskPayload([]byte("h"), mask))
	// second fragment (FIN=1, opcode=0)
	_ = bw.WriteByte(0x80)
	_ = bw.WriteByte(0x80 | 1)
	_, _ = bw.Write(mask)
	_, _ = bw.Write(maskPayload([]byte("i"), mask))
	_ = bw.Flush()
	br := bufio.NewReader(bytes.NewReader(buf.Bytes()))
	op, msg, err := readMessage(br, make([]byte, 16), 16, false)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if op != 0x1 || string(msg) != "hi" {
		t.Fatalf("unexpected %x %q", op, string(msg))
	}
	// ping
	buf.Reset()
	bw = bufio.NewWriter(&buf)
	_ = bw.WriteByte(0x89)
	_ = bw.WriteByte(0x80)
	_, _ = bw.Write(mask)
	_ = bw.Flush()
	br = bufio.NewReader(bytes.NewReader(buf.Bytes()))
	op, _, err = readMessage(br, make([]byte, 16), 16, false)
	if err != nil || op != 0x9 {
		t.Fatalf("expected ping, got %x err=%v", op, err)
	}
	// invalid UTF-8
	inv := []byte{0xff, 0xfe}
	if utf8.Valid(inv) {
		t.Skip("system claims bytes are valid utf8; skip")
	}
	buf.Reset()
	bw = bufio.NewWriter(&buf)
	_ = bw.WriteByte(0x81)
	_ = bw.WriteByte(0x80 | byte(len(inv)))
	_, _ = bw.Write(mask)
	_, _ = bw.Write(maskPayload(inv, mask))
	_ = bw.Flush()
	br = bufio.NewReader(bytes.NewReader(buf.Bytes()))
	_, _, err = readMessage(br, make([]byte, 16), 16, false)
	if err == nil {
		t.Fatalf("expected utf8 error")
	}
}

func TestWS_ReadFrame_InvalidOpcode_And_Oversize(t *testing.T) {
	// invalid opcode 0xB
	var buf bytes.Buffer
	bw := bufio.NewWriter(&buf)
	mask := []byte{1, 2, 3, 4}
	_ = bw.WriteByte(0x8B)
	_ = bw.WriteByte(0x80 | 1)
	_, _ = bw.Write(mask)
	_ = bw.WriteByte('x' ^ mask[0])
	_ = bw.Flush()
	br := bufio.NewReader(bytes.NewReader(buf.Bytes()))
	_, _, _, err := readFrame(br, make([]byte, 8), 8, true, false)
	if err == nil {
		t.Fatalf("expected invalid opcode error")
	}
	// oversize length 127
	buf.Reset()
	bw = bufio.NewWriter(&buf)
	_ = bw.WriteByte(0x82)
	_ = bw.WriteByte(0x80 | 127)
	_ = bw.Flush()
	br = bufio.NewReader(bytes.NewReader(buf.Bytes()))
	_, _, _, err = readFrame(br, make([]byte, 8), 8, true, false)
	if err == nil {
		t.Fatalf("expected oversize error")
	}
}

func TestUpgrade_CheckOriginRejectsUnexpectedBrowserOrigin(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), "GET", "http://example.com/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Key", testWebSocketKey())
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Origin", "https://disallowed.example")

	if _, err := Upgrade(httptest.NewRecorder(), req, Options{CheckOrigin: true}); err == nil || !errors.Is(err, ErrForbiddenOrigin) {
		t.Fatalf("expected ErrForbiddenOrigin, got %v", err)
	}
}

func TestChooseSubprotocol_PrefersAllowedProtocol(t *testing.T) {
	got := chooseSubprotocol("graphql-transport-ws, genapi.auth.bearer.and0", []string{"graphql-transport-ws"})
	if got != "graphql-transport-ws" {
		t.Fatalf("got %q", got)
	}
}

func TestChooseSubprotocol_FallsBackToGeneratedAuthProtocol(t *testing.T) {
	got := chooseSubprotocol("genapi.auth.sig.YWJj, genapi.auth.nonce.bjE", nil)
	if got != "genapi.auth.sig.YWJj" {
		t.Fatalf("got %q", got)
	}
}

// SEC-0008: UpgradeStrict is the fail-closed alternative to Upgrade.
// When OriginAllowlist is nil/empty AND AllowAnyOrigin is unset, the
// handshake MUST be rejected with ErrOriginNotAllowed (HTTP 403). The
// existing Upgrade kept the legacy fail-open semantics for backward
// compatibility; UpgradeStrict is the new required entry point for
// privileged surfaces (MCP WS, REST WS, GraphQL WS).

func newStrictUpgradeReq(origin string) *http.Request {
	req := httptest.NewRequestWithContext(context.Background(), "GET", "http://example.com/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Key", testWebSocketKey())
	req.Header.Set("Sec-WebSocket-Version", "13")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return req
}

func TestUpgradeStrict_NilAllowlistFailsClosed(t *testing.T) {
	req := newStrictUpgradeReq("https://app.example.com")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{})
	if !errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("expected ErrOriginNotAllowed; got %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403; got %d", rec.Code)
	}
}

func TestUpgradeStrict_EmptyAllowlistFailsClosed(t *testing.T) {
	req := newStrictUpgradeReq("https://app.example.com")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{OriginAllowlist: []string{}})
	if !errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("expected ErrOriginNotAllowed; got %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403; got %d", rec.Code)
	}
}

func TestUpgradeStrict_AllowlistMatch(t *testing.T) {
	req := newStrictUpgradeReq("https://app.example.com")
	rec := httptest.NewRecorder()
	// httptest.NewRecorder does not implement http.Hijacker, so the
	// handshake errors AFTER the origin check passes. The presence of
	// ErrNoHijack rather than ErrOriginNotAllowed proves the origin
	// gate accepted the request.
	_, err := UpgradeStrict(rec, req, Options{OriginAllowlist: []string{"https://app.example.com"}})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("origin should have been allowed; got %v", err)
	}
	if err == nil {
		t.Fatal("expected hijack error from httptest.NewRecorder; got nil")
	}
}

func TestUpgradeStrict_AllowlistMiss(t *testing.T) {
	req := newStrictUpgradeReq("https://evil.example")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{OriginAllowlist: []string{"https://app.example.com"}})
	if !errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("expected ErrOriginNotAllowed for unlisted origin; got %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403; got %d", rec.Code)
	}
}

func TestUpgradeStrict_AllowAnyOriginPasses(t *testing.T) {
	req := newStrictUpgradeReq("https://random.example")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{AllowAnyOrigin: true})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("AllowAnyOrigin must permit any origin; got %v", err)
	}
}

func TestUpgradeStrict_EmptyOriginRejected(t *testing.T) {
	// No Origin header set; AllowEmptyOrigin defaults to false.
	req := newStrictUpgradeReq("")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{OriginAllowlist: []string{"https://app.example.com"}})
	if !errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("empty Origin must be rejected by default; got %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403; got %d", rec.Code)
	}
}

func TestUpgradeStrict_EmptyOriginPermitted(t *testing.T) {
	req := newStrictUpgradeReq("")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{
		OriginAllowlist:  []string{"https://app.example.com"},
		AllowEmptyOrigin: true,
	})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("AllowEmptyOrigin must permit missing Origin; got %v", err)
	}
}

func TestUpgradeStrict_AllowAnyOriginEmptyOriginAlsoPasses(t *testing.T) {
	// AllowAnyOrigin should imply that empty Origin is fine too — server-
	// to-server callers and CLIs frequently omit the header.
	req := newStrictUpgradeReq("")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{AllowAnyOrigin: true})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("AllowAnyOrigin must permit empty Origin; got %v", err)
	}
}

func TestUpgradeStrict_BadHandshakeHeadersStillRejected(t *testing.T) {
	// Origin gate passes, but missing Upgrade header must still error
	// out (regression: do not skip the rest of the handshake checks).
	req := httptest.NewRequestWithContext(context.Background(), "GET", "http://example.com/ws", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{OriginAllowlist: []string{"https://app.example.com"}})
	if err == nil {
		t.Fatal("expected handshake error for missing Upgrade headers")
	}
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("missing-headers error should not be ErrOriginNotAllowed; got %v", err)
	}
}

// SEC-0008b / CSWSH defense-in-depth (geode-ui issue 265): SameOriginOnly
// synthesises a same-origin allowlist from r.TLS + r.Host so a route is
// default-deny against cross-origin upgrades without the operator having
// to enumerate every possible deploy host. Composes additively with
// OriginAllowlist so cross-origin SPA deployments still work via an
// explicit allowlist.

func TestUpgradeStrict_SameOriginOnly_AcceptsSameOrigin(t *testing.T) {
	req := newStrictUpgradeReq("http://example.com")
	rec := httptest.NewRecorder()
	// req.Host is "example.com" via httptest.NewRequest; r.TLS is nil
	// because the test request is plain HTTP, so the synthesised
	// allowlist is ["http://example.com"]. The Origin header matches.
	// As elsewhere, the hijack failure proves the origin gate accepted
	// the request — ErrOriginNotAllowed would NOT be returned.
	_, err := UpgradeStrict(rec, req, Options{SameOriginOnly: true})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("SameOriginOnly must accept the synthesised same-origin entry; got %v", err)
	}
	if err == nil {
		t.Fatal("expected hijack error from httptest.NewRecorder; got nil")
	}
}

func TestUpgradeStrict_SameOriginOnly_RejectsCrossOrigin(t *testing.T) {
	req := newStrictUpgradeReq("https://evil.example")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{SameOriginOnly: true})
	if !errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("SameOriginOnly must reject cross-origin upgrades; got %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected HTTP 403; got %d", rec.Code)
	}
}

func TestUpgradeStrict_SameOriginOnly_ComposesWithExplicitAllowlist(t *testing.T) {
	// SameOriginOnly + an explicit allowlist composes additively: the
	// same-origin entry is added on top of the operator's list, so an
	// SPA on a separate trusted host (CDN front-end on app.example.com,
	// API on api.example.com) still works without anyone having to
	// hand-enumerate the API origin too.
	req := newStrictUpgradeReq("https://app.example.com")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{
		SameOriginOnly:  true,
		OriginAllowlist: []string{"https://app.example.com"},
	})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("explicit allowlist must compose additively with SameOriginOnly; got %v", err)
	}
	if err == nil {
		t.Fatal("expected hijack error from httptest.NewRecorder; got nil")
	}
}

func TestUpgradeStrict_SameOriginOnly_HTTPSSchemeFromTLS(t *testing.T) {
	// When r.TLS is non-nil the synthesised origin is scheme=https.
	// Match the "https://example.com" Origin and expect acceptance.
	req := newStrictUpgradeReq("https://example.com")
	req.TLS = &tls.ConnectionState{} // synthetic — only existence matters
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{SameOriginOnly: true})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("SameOriginOnly under TLS must synthesise https scheme; got %v", err)
	}
}

func TestUpgradeStrict_SameOriginOnly_AllowEmptyOriginCarvesOut(t *testing.T) {
	// AllowEmptyOrigin still works in concert with SameOriginOnly so
	// non-browser callers (CLIs that drop the Origin header) keep
	// upgrading. Cross-origin attackers can't forge an empty Origin
	// from a browser, so this carveout is safe.
	req := newStrictUpgradeReq("")
	rec := httptest.NewRecorder()
	_, err := UpgradeStrict(rec, req, Options{
		SameOriginOnly:   true,
		AllowEmptyOrigin: true,
	})
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("SameOriginOnly + AllowEmptyOrigin must permit absent Origin; got %v", err)
	}
}

// TestUpgrade_DeprecatedFailOpenStillWorks proves the legacy Upgrade
// keeps its fail-open semantics for back-compat. SEC-0008 only adds
// UpgradeStrict; flipping the default is scheduled for a major bump.
func TestUpgrade_DeprecatedFailOpenStillWorks(t *testing.T) {
	req := newStrictUpgradeReq("https://anywhere.example")
	rec := httptest.NewRecorder()
	_, err := Upgrade(rec, req, Options{}) // nil allowlist + CheckOrigin=false
	if errors.Is(err, ErrOriginNotAllowed) {
		t.Fatalf("legacy Upgrade should not return ErrOriginNotAllowed when allowlist is nil; got %v", err)
	}
	// Deprecated path passes the origin gate and only fails on the
	// hijack step (httptest.NewRecorder lacks Hijacker).
}
