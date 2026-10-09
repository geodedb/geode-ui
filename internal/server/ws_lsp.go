// /ws/lsp WebSocket-to-TCP bridge.
//
// /ws/lsp proxies a browser WebSocket connection through to an upstream
// Language Server Protocol TCP listener — concretely, `geode serve
// --lsp-port=N` (see geode worktree Task 28). The bridge exists because:
//
//   - Browsers cannot speak the LSP TCP transport directly; they can
//     only speak WebSocket.
//   - The browser already has a JWT for the geode-ui REST surface, so
//     reusing that same bearer for the LSP session avoids a second auth
//     scheme.
//   - The LSP frame envelope ("Content-Length: N\r\n\r\n<json>") is
//     identical to the stdio framing the in-process LSP uses (Task 25's
//     Transport union), so this layer is a pure byte adapter.
//
// Wire shape per direction:
//
//	WS → TCP: each WebSocket text frame is one JSON-RPC message.
//	          The bridge wraps it with a Content-Length header before
//	          writing to the upstream TCP socket. If the frame is a
//	          JSON-RPC "initialize" request, the bridge rewrites
//	          params.initializationOptions.geode.authToken to carry the
//	          caller's JWT — Task 12's AuthState reads exactly that
//	          field. Non-initialize frames are forwarded byte-for-byte.
//
//	TCP → WS: the bridge runs an LSP frame reader on the TCP socket
//	          and emits each decoded body as one text WebSocket frame.
//	          The Content-Length envelope is consumed; only the JSON
//	          body crosses the WebSocket boundary, matching how the
//	          vscode-languageclient package expects to see frames.
//
// Auth: the route's first line of defence is the AuthJWT callback,
// invoked before the WebSocket upgrade. The same callback shape used by
// the generated /ws/query handler (func(*http.Request) error) keeps
// wiring uniform. An anonymous request receives 401 and the upstream
// TCP listener is never dialed.

package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// maxLspMessage caps the per-direction message size to the same 16 MiB
// ceiling enforced by the upstream Zig LSP (MAX_LSP_MESSAGE). Frames
// larger than this on either side abort the bridge — there is no
// legitimate LSP payload that exceeds it.
const maxLspMessage = 16 * 1024 * 1024

// LSP bridge timeouts and limits.
const (
	lspWriteTimeout = 30 * time.Second
	lspPingInterval = 30 * time.Second
	lspDialTimeout  = 5 * time.Second
	// maxLspHeader caps the LSP base-protocol header block
	// ("Content-Length: N\r\n\r\n" plus optional fields).
	maxLspHeader = 4096
)

// wsLspHandler is the http.Handler for /ws/lsp. It is constructed with
// the upstream TCP address (typically 127.0.0.1:3142 for a colocated
// geode serve --lsp-port=3142) and an AuthJWT-shaped callback that
// returns nil on a valid request.
type wsLspHandler struct {
	upstreamAddr string
	auth         func(*http.Request) error
}

// newWsLspHandler constructs the bridge handler. The auth callback may
// be nil in which case the bridge fails closed (every request gets
// 401) — matching the generated genapi behaviour when AuthJWT is
// unset.
func newWsLspHandler(upstreamAddr string, auth func(*http.Request) error) *wsLspHandler {
	return &wsLspHandler{upstreamAddr: upstreamAddr, auth: auth}
}

// ServeHTTP enforces auth, upgrades to WebSocket, dials the upstream
// LSP TCP listener, and runs the bidirectional proxy. Two goroutines
// drive the proxy; the first error closes both sockets via the deferred
// Close calls.
func (h *wsLspHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.auth(r); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Re-extract the bearer token after auth succeeded — we need the
	// raw token (not just the parsed claims) to inject into the LSP
	// initialize frame downstream. extractBearer is exposed in auth.go
	// and tolerates either the Authorization header or
	// ?access_token= query string fallback.
	token, _ := extractBearer(r)

	// UpgradeStrict is the fail-closed origin-check entry point introduced
	// after SEC-0008 — `Upgrade` is now deprecated. The bridge is exposed
	// on the same origin as the rest of the API, so we set
	// AllowAnyOrigin=true to match the generated /ws/query behaviour;
	// when an explicit allowlist lands in config we'll plumb it through
	// here too.
	conn, err := wsx.UpgradeStrict(w, r, wsx.Options{
		MaxFrame:       maxLspMessage,
		MaxMessage:     maxLspMessage,
		ReadTimeout:    0,
		WriteTimeout:   lspWriteTimeout,
		PingInterval:   lspPingInterval,
		AllowAnyOrigin: true,
	})
	if err != nil {
		// Upgrade writes its own 4xx response on header validation
		// failures; we have nothing more to do.
		return
	}
	defer func() { _ = conn.Close() }()

	tcp, err := net.DialTimeout("tcp", h.upstreamAddr, lspDialTimeout)
	if err != nil {
		// A close frame surfaces the failure mode cleanly to the
		// browser; the WebSocket library can't send an HTTP error at
		// this point because we have already switched protocols.
		_ = conn.WriteMessage(wsx.OpClose, []byte{0x03, 0xEA}) // 1002 protocol error
		return
	}
	defer func() { _ = tcp.Close() }()

	// One slot per proxy direction so neither goroutine blocks on send.
	const proxyDirections = 2
	errCh := make(chan error, proxyDirections)
	go func() { errCh <- proxyWsToTCP(conn, tcp, token) }()
	go func() { errCh <- proxyTCPToWs(tcp, conn) }()
	// The first goroutine to error (or hit EOF) unblocks the receive;
	// the deferred Close calls on both sockets cascade the shutdown to
	// the second goroutine.
	<-errCh
}

// proxyWsToTCP reads WebSocket text frames in a loop, optionally
// rewrites JSON-RPC initialize requests to carry the caller's bearer
// token, and writes each frame to the upstream TCP socket with an LSP
// Content-Length envelope. Returns on the first read or write error
// (including normal close).
func proxyWsToTCP(ws *wsx.Conn, tcp net.Conn, token string) error {
	for {
		op, body, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		switch op {
		case wsx.OpText:
			// LSP frames are JSON — handle below.
		case wsx.OpPing, wsx.OpPong:
			// Transport-level keepalive; not application data.
			continue
		case wsx.OpClose:
			return errors.New("ws: peer closed connection")
		case wsx.OpBinary:
			return errors.New("ws: unexpected binary frame")
		default:
			return fmt.Errorf("ws: unexpected opcode 0x%x", op)
		}
		if len(body) > maxLspMessage {
			return fmt.Errorf("ws: frame %d bytes exceeds %d cap", len(body), maxLspMessage)
		}
		body = injectAuthIntoInitialize(body, token)
		header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body))
		if _, err := tcp.Write([]byte(header)); err != nil {
			return err
		}
		if _, err := tcp.Write(body); err != nil {
			return err
		}
	}
}

// proxyTCPToWs reads framed LSP messages from the upstream TCP socket
// and emits each body as a single WebSocket text frame. Returns nil on
// clean EOF, error on any other failure.
func proxyTCPToWs(tcp net.Conn, ws *wsx.Conn) error {
	rd := newLspFrameReader(tcp)
	for {
		frame, err := rd.ReadFrame()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := ws.WriteMessage(wsx.OpText, frame); err != nil {
			return err
		}
	}
}

// injectAuthIntoInitialize rewrites a JSON-RPC "initialize" request to
// carry the caller's bearer token at
// params.initializationOptions.geode.authToken. This is the exact
// field AuthState.parseInitOpts in the geode worktree reads (Task 10).
//
// For any non-initialize message — including responses, notifications,
// and methods other than "initialize" — the body round-trips unchanged.
// For malformed JSON the body also round-trips unchanged: the upstream
// LSP gets to decide what error to surface. token may be empty (e.g.
// when the caller is exempt via --no-auth on the LSP side); in that
// case the field is still set so the field's presence cannot leak the
// allow/deny decision.
func injectAuthIntoInitialize(body []byte, token string) []byte {
	var msg map[string]any
	if err := json.Unmarshal(body, &msg); err != nil {
		return body
	}
	method, _ := msg["method"].(string)
	if method != "initialize" {
		return body
	}
	params, _ := msg["params"].(map[string]any)
	if params == nil {
		params = map[string]any{}
		msg["params"] = params
	}
	initOpts, _ := params["initializationOptions"].(map[string]any)
	if initOpts == nil {
		initOpts = map[string]any{}
		params["initializationOptions"] = initOpts
	}
	geode, _ := initOpts["geode"].(map[string]any)
	if geode == nil {
		geode = map[string]any{}
		initOpts["geode"] = geode
	}
	geode["authToken"] = token
	out, err := json.Marshal(msg)
	if err != nil {
		return body
	}
	return out
}

// lspFrameReader decodes the LSP/JSON-RPC wire framing
// ("Content-Length: N\r\n\r\n<body>") from an io.Reader. Identical
// envelope to the stdio framing used by the Zig LSP server, so the
// bridge is a pure byte adapter.
type lspFrameReader struct {
	r io.Reader
}

func newLspFrameReader(r io.Reader) *lspFrameReader { return &lspFrameReader{r: r} }

// ReadFrame consumes one LSP frame. Returns the JSON body bytes
// (without the Content-Length envelope) on success, io.EOF when the
// stream closes cleanly between frames, and any other error verbatim.
//
// A header section larger than 4 KiB or a body larger than
// maxLspMessage is rejected; the LSP wire format does not require
// headers that large, and a misbehaving peer must not be allowed to
// allocate unbounded memory.
func (f *lspFrameReader) ReadFrame() ([]byte, error) {
	var header []byte
	buf := make([]byte, 1)
	for {
		n, err := f.r.Read(buf)
		if err != nil {
			// Treat a clean EOF before any header bytes arrive as a
			// graceful shutdown — the caller distinguishes this from
			// a mid-frame truncation via errors.Is(io.EOF).
			if errors.Is(err, io.EOF) && len(header) == 0 {
				return nil, io.EOF
			}
			return nil, err
		}
		if n == 0 {
			continue
		}
		header = append(header, buf[0])
		if len(header) >= 4 && string(header[len(header)-4:]) == "\r\n\r\n" {
			break
		}
		if len(header) > maxLspHeader {
			return nil, errors.New("LSP header too large")
		}
	}
	headerStr := string(header)
	// Header field names are case-insensitive per RFC 7230; locate the
	// Content-Length entry without forcing the upstream to use a
	// specific case.
	lowerIdx := strings.Index(strings.ToLower(headerStr), "content-length:")
	if lowerIdx < 0 {
		return nil, errors.New("LSP: missing Content-Length header")
	}
	// Slice off everything before "Content-Length:" so the integer
	// parse starts at the prefix.
	tail := headerStr[lowerIdx+len("Content-Length:"):]
	tail = strings.TrimLeft(tail, " \t")
	// Cut at the first \r or \n.
	if i := strings.IndexAny(tail, "\r\n"); i >= 0 {
		tail = tail[:i]
	}
	var n int
	if _, err := fmt.Sscanf(tail, "%d", &n); err != nil {
		return nil, fmt.Errorf("LSP: bad Content-Length: %w", err)
	}
	if n < 0 || n > maxLspMessage {
		return nil, fmt.Errorf("LSP: Content-Length %d outside [0,%d]", n, maxLspMessage)
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(f.r, body); err != nil {
		return nil, err
	}
	return body, nil
}
