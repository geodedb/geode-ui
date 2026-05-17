// Package server: tests for the /ws/lsp WebSocket-to-TCP bridge.
//
// The bridge proxies a browser WebSocket connection through to an
// upstream LSP TCP listener (geode serve --lsp-port=N). The tests here
// exercise three contracts:
//
//  1. Auth gate — the upgrade is rejected with 401 when no JWT is
//     attached (neither Authorization header nor ?access_token=).
//  2. Wire fidelity — a JSON message written from the WS client lands
//     verbatim on the upstream TCP side, framed with the LSP standard
//     Content-Length envelope.
//  3. initialize injection — the bridge re-injects the caller's bearer
//     token into params.initializationOptions.geode.authToken when the
//     WS frame is a JSON-RPC "initialize" request, so the LSP session
//     can authenticate without the browser having to know the upstream
//     auth scheme.
package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// fakeLspTcp accepts a single LSP TCP connection on a local port and
// makes the next decoded frame available to the test via WaitForFrame.
// Modeled on the LSP-side framing used by zig's Transport / TcpTransport
// (Tasks 25/26): one Content-Length: N\r\n\r\n header followed by N
// bytes of JSON body. Frames are surfaced one-at-a-time so tests can
// assert on exactly the wire bytes the bridge produced.
type fakeLspTcp struct {
	ln    net.Listener
	mu    sync.Mutex
	frame []byte
	got   chan struct{}
	done  chan struct{}
}

func newFakeLspTcp(t *testing.T) *fakeLspTcp {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	f := &fakeLspTcp{ln: ln, got: make(chan struct{}, 1), done: make(chan struct{})}
	go f.serve()
	return f
}

func (f *fakeLspTcp) Addr() string { return f.ln.Addr().String() }

func (f *fakeLspTcp) Close() {
	_ = f.ln.Close()
	select {
	case <-f.done:
	default:
		close(f.done)
	}
}

func (f *fakeLspTcp) serve() {
	c, err := f.ln.Accept()
	if err != nil {
		return
	}
	defer func() { _ = c.Close() }()
	br := bufio.NewReader(c)
	// Read one LSP frame: headers until \r\n\r\n, then N body bytes.
	var headerLine string
	var contentLen int
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		headerLine = line
		if strings.HasPrefix(strings.ToLower(headerLine), "content-length:") {
			parts := strings.SplitN(headerLine, ":", 2)
			if len(parts) == 2 {
				v := strings.TrimSpace(parts[1])
				_, _ = fmt.Sscanf(v, "%d", &contentLen)
			}
		}
	}
	if contentLen <= 0 || contentLen > 16*1024*1024 {
		return
	}
	body := make([]byte, contentLen)
	if _, err := io.ReadFull(br, body); err != nil {
		return
	}
	f.mu.Lock()
	f.frame = body
	f.mu.Unlock()
	select {
	case f.got <- struct{}{}:
	default:
	}
	// Stay alive so the bridge does not see an immediate EOF; the
	// test will close us when it returns.
	<-f.done
}

// WaitForFrame blocks until the fake LSP has decoded one frame from
// the bridge, then returns the JSON body bytes. Fails the test on
// timeout — a deadlocked bridge would otherwise hang the suite.
func (f *fakeLspTcp) WaitForFrame(t *testing.T) []byte {
	t.Helper()
	select {
	case <-f.got:
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.frame
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for upstream LSP frame")
		return nil
	}
}

// newTestLspServer wires a fresh *http.ServeMux to the bridge and
// returns the *httptest.Server plus the *GraphServer (which owns the
// JWT issuer) so tests can mint matching tokens. upstreamAddr is the
// address of the fake LSP TCP listener.
//
// We use a fresh *GraphServer purely for its AuthJWT method; the bridge
// itself only needs the func(*http.Request) error shape.
func newTestLspServer(t *testing.T, upstreamAddr string) (*httptest.Server, *GraphServer) {
	t.Helper()
	iss := newTestIssuer(t)
	srv := New(Config{JWT: iss})
	mux := http.NewServeMux()
	// Tests run against httptest.NewServer which mints a random local
	// 127.0.0.1:N origin per test. Passing nil allowedOrigins picks the
	// same-origin default from the handler — exactly what production
	// uses when no operator override is supplied.
	RegisterLspWS(mux, srv.AuthJWT, upstreamAddr, nil)
	hs := httptest.NewServer(mux)
	return hs, srv
}

// mintTestToken issues a JWT for sub against the test issuer attached
// to srv. Returns the encoded token.
func mintTestToken(t *testing.T, srv *GraphServer, sub string) string {
	t.Helper()
	tok, _, err := srv.cfg.JWT.Issue(sub, "default", nil, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	return tok
}

// TestWsLspRequiresAuth — no Authorization header / no access_token
// query param ⇒ the bridge rejects the upgrade with 401 before any
// upstream TCP dial happens. The fake LSP is still started but its
// Accept() will not see a connection: the auth gate must short-circuit
// before Dial.
func TestWsLspRequiresAuth(t *testing.T) {
	upstream := newFakeLspTcp(t)
	defer upstream.Close()
	hs, _ := newTestLspServer(t, upstream.Addr())
	defer hs.Close()

	wsURL := "ws" + strings.TrimPrefix(hs.URL, "http") + "/ws/lsp"
	_, err := wsx.Dial(context.Background(), wsURL, wsx.DialOptions{
		HandshakeTimeout: 2 * time.Second,
		MaxFrame:         4096,
		MaxMessage:       65536,
	})
	if err == nil {
		t.Fatal("expected dial failure without token")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("want 401 in error, got %v", err)
	}
}

// TestWsLspProxiesFrameToUpstream — happy path. With a valid JWT on
// ?access_token=, the upgrade succeeds, and a JSON message written
// from the WS client arrives intact on the upstream TCP side wrapped
// in a Content-Length frame.
func TestWsLspProxiesFrameToUpstream(t *testing.T) {
	upstream := newFakeLspTcp(t)
	defer upstream.Close()
	hs, srv := newTestLspServer(t, upstream.Addr())
	defer hs.Close()
	tok := mintTestToken(t, srv, "alice")

	wsURL := "ws" + strings.TrimPrefix(hs.URL, "http") + "/ws/lsp?access_token=" + tok
	c, err := wsx.Dial(context.Background(), wsURL, wsx.DialOptions{
		HandshakeTimeout: 2 * time.Second,
		MaxFrame:         4096,
		MaxMessage:       65536,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = c.Close() }()

	// Non-initialize frame — should pass through unchanged.
	payload := []byte(`{"jsonrpc":"2.0","id":7,"method":"textDocument/completion","params":{}}`)
	if err := c.WriteMessage(wsx.OpText, payload); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := upstream.WaitForFrame(t)
	if string(got) != string(payload) {
		t.Fatalf("upstream frame mismatch:\n  got  %s\n  want %s", got, payload)
	}
}

// TestWsLspInjectsAuthIntoInitialize — when the WS client sends a
// JSON-RPC "initialize" frame, the bridge rewrites it to add the
// caller's bearer token at params.initializationOptions.geode.authToken
// before forwarding. The Geode LSP authenticates off this token (Task
// 12); the browser would otherwise have to know the upstream auth
// scheme.
func TestWsLspInjectsAuthIntoInitialize(t *testing.T) {
	upstream := newFakeLspTcp(t)
	defer upstream.Close()
	hs, srv := newTestLspServer(t, upstream.Addr())
	defer hs.Close()
	tok := mintTestToken(t, srv, "alice")

	wsURL := "ws" + strings.TrimPrefix(hs.URL, "http") + "/ws/lsp?access_token=" + tok
	c, err := wsx.Dial(context.Background(), wsURL, wsx.DialOptions{
		HandshakeTimeout: 2 * time.Second,
		MaxFrame:         4096,
		MaxMessage:       65536,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = c.Close() }()

	payload := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	if err := c.WriteMessage(wsx.OpText, payload); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := upstream.WaitForFrame(t)

	var msg map[string]any
	if err := json.Unmarshal(got, &msg); err != nil {
		t.Fatalf("decode upstream frame: %v\nbody: %s", err, got)
	}
	params, _ := msg["params"].(map[string]any)
	initOpts, _ := params["initializationOptions"].(map[string]any)
	geode, _ := initOpts["geode"].(map[string]any)
	authTok, _ := geode["authToken"].(string)
	if authTok != tok {
		t.Fatalf("authToken=%q want %q", authTok, tok)
	}
}

// TestInjectAuthIntoInitialize_Passthrough exercises the no-op branch:
// frames whose method is not "initialize" must pass through unchanged.
// This is a unit test on the helper so we don't need the upstream / WS
// scaffolding to assert it.
func TestInjectAuthIntoInitialize_Passthrough(t *testing.T) {
	cases := []string{
		`{"jsonrpc":"2.0","id":2,"method":"textDocument/didOpen","params":{}}`,
		`{"jsonrpc":"2.0","id":3,"method":"shutdown"}`,
		`{"jsonrpc":"2.0","result":{"x":1},"id":4}`, // response — no method
	}
	for _, in := range cases {
		out := injectAuthIntoInitialize([]byte(in), "tok-abc")
		if string(out) != in {
			t.Fatalf("expected passthrough\n  in:  %s\n  out: %s", in, out)
		}
	}
}

// TestInjectAuthIntoInitialize_MalformedBypass — a body that is not
// valid JSON must round-trip unchanged. Defends against the bridge
// accidentally corrupting a frame just because we couldn't parse it
// (the LSP backend gets to decide what to do with malformed input).
func TestInjectAuthIntoInitialize_MalformedBypass(t *testing.T) {
	in := []byte(`{"jsonrpc":"2.0", malformed`)
	out := injectAuthIntoInitialize(in, "tok")
	if string(out) != string(in) {
		t.Fatalf("expected passthrough for malformed body, got %s", out)
	}
}

// TestWsLspRejectsCrossOriginUpgrade pins SEC issue 265: an explicit
// cross-origin Origin header (one that does NOT match the request Host)
// MUST be rejected by UpgradeStrict, regardless of whether the request
// carries a valid JWT. The geode-ui-auth cookie is SameSite=Strict, so
// the cookie-mode CSWSH vector is already blocked at the cookie layer;
// this gate adds defense-in-depth against a future SameSite regression
// + the query-token mode used by the SPA's LSP client.
func TestWsLspRejectsCrossOriginUpgrade(t *testing.T) {
	upstream := newFakeLspTcp(t)
	defer upstream.Close()
	hs, srv := newTestLspServer(t, upstream.Addr())
	defer hs.Close()
	tok := mintTestToken(t, srv, "alice")

	// Forge a cross-origin Origin header. wsx.Dial doesn't expose an
	// Origin override directly, so we drive the raw HTTP upgrade with
	// net/http and assert the server returns a 4xx.
	wsURL := strings.TrimPrefix(hs.URL, "http://")
	c, err := net.Dial("tcp", wsURL)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = c.Close() }()
	req := "GET /ws/lsp?access_token=" + tok + " HTTP/1.1\r\n" +
		"Host: " + wsURL + "\r\n" +
		"Origin: https://evil.example.com\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade: %v", err)
	}
	br := bufio.NewReader(c)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	// A cross-origin Origin must NOT yield a 101 Switching Protocols;
	// the exact non-101 status is wsx's call (typically 403). What we
	// care about is that the bridge refused to upgrade.
	if strings.Contains(statusLine, "101") {
		t.Fatalf("cross-origin upgrade was allowed: %q", strings.TrimSpace(statusLine))
	}
}

// TestWsLspAcceptsSameOriginUpgrade is the positive companion: an
// Origin header that DOES match the request Host (the same-origin
// default for the SPA) still succeeds end-to-end. Pins that the new
// same-origin default isn't over-restrictive against the production
// SPA shape.
func TestWsLspAcceptsSameOriginUpgrade(t *testing.T) {
	upstream := newFakeLspTcp(t)
	defer upstream.Close()
	hs, srv := newTestLspServer(t, upstream.Addr())
	defer hs.Close()
	tok := mintTestToken(t, srv, "alice")

	host := strings.TrimPrefix(hs.URL, "http://")
	c, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = c.Close() }()
	// Origin matches the same-origin URL the handler synthesises from
	// r.Host + (no r.TLS so http://). The handshake key is a valid
	// 16-byte base64 nonce; the server returns 101 Switching Protocols
	// on a successful upgrade.
	req := "GET /ws/lsp?access_token=" + tok + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Origin: http://" + host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade: %v", err)
	}
	br := bufio.NewReader(c)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	if !strings.Contains(statusLine, "101") {
		t.Fatalf("same-origin upgrade rejected: %q", strings.TrimSpace(statusLine))
	}
}

// TestLspFrameReader covers the LSP framing parser used on the
// TCP→WS direction. We feed it a synthesized LSP stream and assert
// that ReadFrame returns the body verbatim, and that a stream missing
// Content-Length is rejected.
func TestLspFrameReader(t *testing.T) {
	body := `{"jsonrpc":"2.0","method":"window/logMessage","params":{}}`
	stream := "Content-Length: " + fmt.Sprintf("%d", len(body)) + "\r\n\r\n" + body
	r := newLspFrameReader(strings.NewReader(stream))
	got, err := r.ReadFrame()
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if string(got) != body {
		t.Fatalf("body=%q want %q", got, body)
	}

	// Missing Content-Length should error.
	r2 := newLspFrameReader(strings.NewReader("X-Foo: bar\r\n\r\nhello"))
	if _, err := r2.ReadFrame(); err == nil {
		t.Fatal("expected error for missing Content-Length")
	}
}
