package mcpx

import (
	"bufio"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// hijackWriter is a minimal http.ResponseWriter + http.Hijacker backed by a
// net.Conn. ServeWS uses Hijack() to take ownership of the connection.
type hijackWriter struct {
	net.Conn
	hdr  http.Header
	code int
}

func (h *hijackWriter) Header() http.Header         { return h.hdr }
func (h *hijackWriter) WriteHeader(code int)        { h.code = code }
func (h *hijackWriter) Write(b []byte) (int, error) { return h.Conn.Write(b) }
func (h *hijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	bw := bufio.NewReadWriter(bufio.NewReader(h.Conn), bufio.NewWriter(h.Conn))
	return h.Conn, bw, nil
}

// sendMaskedTextFrame sends a masked client-to-server WebSocket text frame.
func sendMaskedTextFrame(conn net.Conn, payload []byte) error {
	mask := [4]byte{0x37, 0x42, 0x13, 0x77}
	masked := make([]byte, len(payload))
	for i, b := range payload {
		masked[i] = b ^ mask[i%4]
	}
	bw := bufio.NewWriter(conn)
	_ = bw.WriteByte(0x81) // FIN=1, opcode=1 (text)
	ln := len(payload)
	if ln < 126 {
		_ = bw.WriteByte(0x80 | byte(ln))
	} else {
		_ = bw.WriteByte(0x80 | 126)
		_ = bw.WriteByte(byte(ln >> 8))
		_ = bw.WriteByte(byte(ln))
	}
	_, _ = bw.Write(mask[:])
	_, _ = bw.Write(masked)
	return bw.Flush()
}

// consumeUpgradeHeaders reads through the 101 Switching Protocols HTTP
// response on br until the blank CRLF line that ends the headers.
func consumeUpgradeHeaders(br *bufio.Reader) error {
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return err
		}
		if line == "\r\n" {
			return nil
		}
	}
}

// readServerFrame reads an unmasked server-to-client WebSocket text frame.
// Server frames are never masked (RFC 6455 §5.1).
func readServerFrame(br *bufio.Reader) ([]byte, error) {
	b1, err := br.ReadByte()
	if err != nil {
		return nil, err
	}
	b2, err := br.ReadByte()
	if err != nil {
		return nil, err
	}
	_ = b1 // FIN + opcode — we accept any frame the server sends
	ln := int(b2 & 0x7F)
	switch ln {
	case 126:
		x := make([]byte, 2)
		if _, err := br.Read(x); err != nil {
			return nil, err
		}
		ln = int(x[0])<<8 | int(x[1])
	case 127:
		return nil, nil // too large, not needed for tests
	}
	p := make([]byte, ln)
	if _, err := br.Read(p); err != nil {
		return nil, err
	}
	return p, nil
}

// TestServeWS_E2E verifies that a JSON-RPC "ping" sent over a WebSocket
// connection (via net.Pipe) receives a JSON-RPC response with result.ok=true.
// This test also exercises the bug-1.1 fix (\r\r → \r\n\r\n).
func TestServeWS_E2E(t *testing.T) {
	installHeaderAuthVerifier(t)
	toolBuckets = nil
	SetToolTimeout(5 * time.Second)
	configureMCPWSAllowlist(t, []string{"https://app.example"})

	tools := map[string]Tool{
		"echo": func(p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}

	// net.Pipe gives us a synchronous, in-process pair of net.Conn.
	clientConn, serverConn := net.Pipe()

	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		defer func() { _ = serverConn.Close() }()
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")
		req.Header.Set("Authorization", "Bearer test-token")
		// SEC-0008: ServeWS uses UpgradeStrict; supply a matching
		// allowlist + Origin so the handshake reaches the JSON-RPC
		// loop. The fail-closed default is exercised separately in
		// TestServeWS_FailsClosed_NilAllowlistNoAllowAny.
		req.Header.Set("Origin", "https://app.example")
		hw := &hijackWriter{Conn: serverConn, hdr: make(http.Header)}
		ServeWS(hw, req, tools)
	}()

	// The server writes the 101 response first (synchronous pipe — we must
	// read before the server can proceed past rw.Flush()).
	br := bufio.NewReader(clientConn)
	_ = clientConn.SetDeadline(time.Now().Add(5 * time.Second))
	if err := consumeUpgradeHeaders(br); err != nil {
		_ = clientConn.Close()
		<-serverDone
		t.Fatalf("reading upgrade response: %v", err)
	}

	// Send a JSON-RPC "ping" request.
	ping := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"}
	payload, _ := json.Marshal(ping)
	if err := sendMaskedTextFrame(clientConn, payload); err != nil {
		_ = clientConn.Close()
		<-serverDone
		t.Fatalf("sendMaskedTextFrame: %v", err)
	}

	// Read the server's JSON-RPC response frame.
	_ = clientConn.SetDeadline(time.Now().Add(5 * time.Second))
	response, err := readServerFrame(br)
	// Close client to unblock the server's read loop, then wait for it to exit.
	_ = clientConn.Close()
	<-serverDone
	if err != nil {
		t.Fatalf("readServerFrame: %v", err)
	}

	var out map[string]any
	if err := json.Unmarshal(response, &out); err != nil {
		t.Fatalf("unmarshal %q: %v", response, err)
	}
	res, _ := out["result"].(map[string]any)
	if ok, _ := res["ok"].(bool); !ok {
		t.Fatalf("expected result.ok=true, got %#v", out)
	}
}

// TestServeWS_E2E_ToolCall verifies that a tools/call request works end-to-end
// over WebSocket after the bug-1.1 fix.
func TestServeWS_E2E_ToolCall(t *testing.T) {
	installHeaderAuthVerifier(t)
	toolBuckets = nil
	SetToolTimeout(5 * time.Second)
	configureMCPWSAllowlist(t, []string{"https://app.example"})

	tools := map[string]Tool{
		"greet": func(p jsontext.Value) (jsontext.Value, error) {
			return json.Marshal(map[string]string{"hello": "world"})
		},
	}

	clientConn, serverConn := net.Pipe()

	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		defer func() { _ = serverConn.Close() }()
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")
		req.Header.Set("Authorization", "Bearer test-token")
		// SEC-0008: ServeWS uses UpgradeStrict; supply a matching
		// allowlist + Origin so the handshake reaches the JSON-RPC
		// loop. The fail-closed default is exercised separately in
		// TestServeWS_FailsClosed_NilAllowlistNoAllowAny.
		req.Header.Set("Origin", "https://app.example")
		hw := &hijackWriter{Conn: serverConn, hdr: make(http.Header)}
		ServeWS(hw, req, tools)
	}()

	br := bufio.NewReader(clientConn)
	_ = clientConn.SetDeadline(time.Now().Add(5 * time.Second))
	if err := consumeUpgradeHeaders(br); err != nil {
		_ = clientConn.Close()
		<-serverDone
		t.Fatalf("reading upgrade response: %v", err)
	}

	req := map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/call",
		"params":  map[string]any{"name": "greet", "params": map[string]any{}},
	}
	payload, _ := json.Marshal(req)
	if err := sendMaskedTextFrame(clientConn, payload); err != nil {
		_ = clientConn.Close()
		<-serverDone
		t.Fatalf("sendMaskedTextFrame: %v", err)
	}

	_ = clientConn.SetDeadline(time.Now().Add(5 * time.Second))
	response, err := readServerFrame(br)
	_ = clientConn.Close()
	<-serverDone
	if err != nil {
		t.Fatalf("readServerFrame: %v", err)
	}

	var out map[string]any
	if err := json.Unmarshal(response, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out["error"] != nil {
		t.Fatalf("unexpected error: %#v", out["error"])
	}
	if out["result"] == nil {
		t.Fatalf("expected result, got nil")
	}
}

// configureMCPWSAllowlist sets the MCP WS origin allowlist for the
// duration of the test and restores the prior state via t.Cleanup.
// SEC-0008: ServeWS now calls wsx.UpgradeStrict, which requires either
// a non-empty allowlist or wsAllowAnyOrigin=true.
func configureMCPWSAllowlist(t *testing.T, origins []string) {
	t.Helper()
	prevList := wsOriginAllowlist
	prevAny := wsAllowAnyOrigin
	SetWSOriginAllowlist(origins)
	SetWSAllowAnyOrigin(false)
	t.Cleanup(func() {
		wsOriginAllowlist = prevList
		wsAllowAnyOrigin = prevAny
	})
}

// TestServeWS_FailsClosed_NilAllowlistNoAllowAny is the SEC-0008
// regression assertion. With wsOriginAllowlist nil and
// wsAllowAnyOrigin false (the historical default), ServeWS must
// reject the upgrade with HTTP 403 — no JSON-RPC loop, no upgrade
// headers, no leak of session state.
func TestServeWS_FailsClosed_NilAllowlistNoAllowAny(t *testing.T) {
	installHeaderAuthVerifier(t)
	prevList := wsOriginAllowlist
	prevAny := wsAllowAnyOrigin
	SetWSOriginAllowlist(nil)
	SetWSAllowAnyOrigin(false)
	t.Cleanup(func() {
		wsOriginAllowlist = prevList
		wsAllowAnyOrigin = prevAny
	})

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Origin", "https://app.example")
	rec := httptest.NewRecorder()
	ServeWS(rec, req, map[string]Tool{})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403; got %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestServeWS_FailsClosed_OriginNotInAllowlist confirms that even with
// a populated allowlist, an Origin that is not on the list is rejected
// (the existing reject-bad-origin behaviour, but now via UpgradeStrict's
// 403 response).
func TestServeWS_FailsClosed_OriginNotInAllowlist(t *testing.T) {
	installHeaderAuthVerifier(t)
	configureMCPWSAllowlist(t, []string{"https://app.example"})

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	ServeWS(rec, req, map[string]Tool{})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403; got %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestServeWS_AllowAnyOriginPasses is the explicit opt-in regression
// test: when wsAllowAnyOrigin is true the upgrade proceeds (until the
// hijack fails on httptest.NewRecorder, which lacks Hijacker support).
// We assert that 403 is NOT the response — the strict origin gate did
// not fire.
func TestServeWS_AllowAnyOriginPasses(t *testing.T) {
	installHeaderAuthVerifier(t)
	prevList := wsOriginAllowlist
	prevAny := wsAllowAnyOrigin
	SetWSOriginAllowlist(nil)
	SetWSAllowAnyOrigin(true)
	t.Cleanup(func() {
		wsOriginAllowlist = prevList
		wsAllowAnyOrigin = prevAny
	})

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Origin", "https://anything.example")
	rec := httptest.NewRecorder()
	ServeWS(rec, req, map[string]Tool{})
	if rec.Code == http.StatusForbidden {
		t.Fatalf("AllowAnyOrigin must permit the upgrade; got 403 body=%s", rec.Body.String())
	}
}

// Prevent import cycle — httptest is used for its recorder type only.
var _ = httptest.NewRecorder
