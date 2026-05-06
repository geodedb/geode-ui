package wsx

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // SHA-1 required by RFC 6455 WebSocket handshake
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"geodedb.com/geode-ui/gen/pkg/gen"
	"geodedb.com/geode-ui/gen/pkg/obsx"
)

// Options controls WebSocket upgrade and connection behavior.
type Options struct {
	OriginAllowlist []string
	CheckOrigin     bool
	Protocols       []string // allowed subprotocols; first match is selected
	MaxFrame        int      // max single frame payload
	MaxMessage      int      // max reassembled message
	PingInterval    time.Duration
	ReadTimeout     time.Duration // per-read deadline; 0 = none
	WriteTimeout    time.Duration // per-write deadline; 0 = none
}

// DialOptions controls client-side WebSocket dialing.
type DialOptions struct {
	Headers          http.Header
	Origin           string
	Protocols        []string
	HandshakeTimeout time.Duration
	MaxFrame         int
	MaxMessage       int
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
}

// Conn is a minimal WebSocket text/binary connection.
type Conn struct {
	c                  net.Conn
	br                 *bufio.Reader
	bw                 *bufio.Writer
	maxFrame           int
	maxMessage         int
	pingStop           chan struct{}
	readTO             time.Duration
	writeTO            time.Duration
	allowUnmaskedReads bool
	maskWrites         bool
}

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

func newConn(c net.Conn, br *bufio.Reader, bw *bufio.Writer, opts Options, allowUnmaskedReads, maskWrites bool) *Conn {
	if br == nil {
		br = bufio.NewReader(c)
	}
	if bw == nil {
		bw = bufio.NewWriter(c)
	}
	return &Conn{
		c:                  c,
		br:                 br,
		bw:                 bw,
		maxFrame:           max(1024, opts.MaxFrame),
		maxMessage:         max(1024, opts.MaxMessage),
		readTO:             opts.ReadTimeout,
		writeTO:            opts.WriteTimeout,
		allowUnmaskedReads: allowUnmaskedReads,
		maskWrites:         maskWrites,
	}
}

// Upgrade performs an RFC6455 upgrade and returns a Conn.
func Upgrade(w http.ResponseWriter, r *http.Request, opts Options) (*Conn, error) {
	if strings.ToLower(r.Header.Get("Connection")) != "upgrade" || strings.ToLower(r.Header.Get("Upgrade")) != "websocket" {
		return nil, errors.New("bad upgrade headers")
	}
	if strings.TrimSpace(r.Header.Get("Sec-WebSocket-Version")) != "13" {
		return nil, errors.New("unsupported websocket version")
	}
	if opts.CheckOrigin || len(opts.OriginAllowlist) > 0 {
		orig := strings.TrimSpace(r.Header.Get("Origin"))
		if orig == "" {
			goto originOK
		}
		ok := false
		for _, o := range opts.OriginAllowlist {
			if o == "*" || strings.EqualFold(o, orig) {
				ok = true
				break
			}
		}
		if !ok {
			return nil, errors.New("forbidden origin")
		}
	}
originOK:
	chosenProto := chooseSubprotocol(r.Header.Get("Sec-WebSocket-Protocol"), opts.Protocols)
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("no hijack")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	decodedKey, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(key))
	if key == "" || decErr != nil || len(decodedKey) != 16 {
		_, _ = rw.WriteString("HTTP/1.1 400 Bad Request\r\n\r\n")
		_ = rw.Flush()
		_ = conn.Close()
		return nil, errors.New("invalid websocket key")
	}
	accept := computeAccept(key)
	_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\n")
	_, _ = rw.WriteString("Upgrade: websocket\r\n")
	_, _ = rw.WriteString("Connection: Upgrade\r\n")
	if chosenProto != "" {
		_, _ = rw.WriteString("Sec-WebSocket-Protocol: " + chosenProto + "\r\n")
	}
	_, _ = rw.WriteString("Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	c := newConn(conn, rw.Reader, rw.Writer, opts, false, false)
	if opts.PingInterval > 0 {
		c.pingStop = make(chan struct{})
		gen.SafeLoop("ws-ping", c.pingStop, func(stop <-chan struct{}) {
			t := time.NewTicker(opts.PingInterval)
			defer t.Stop()
			for {
				select {
				case <-t.C:
					_ = c.WriteMessage(0x9, nil)
				case <-stop:
					return
				}
			}
		})
	}
	return c, nil
}

// NewConn wraps an existing net.Conn as a WebSocket connection.
// Unlike Upgrade, this skips the HTTP handshake — use it for
// in-memory pipes or pre-established connections.
func NewConn(c net.Conn, opts Options) *Conn {
	return newConn(c, nil, nil, opts, true, false)
}

// Close sends a close frame then closes the connection.
func (c *Conn) Close() error {
	if c.pingStop != nil {
		close(c.pingStop)
	}
	// Best-effort close frame; set a short deadline so we don't block
	// on synchronous connections like net.Pipe().
	_ = c.c.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
	_ = writeFrame(c.bw, 0x8, []byte{0, 0}, c.maskWrites)
	return c.c.Close()
}

// ReadMessage reads a full message (reassembling fragments). Returns opcode and payload.
func (c *Conn) ReadMessage() (byte, []byte, error) {
	if c.readTO > 0 {
		_ = c.c.SetReadDeadline(time.Now().Add(c.readTO))
	}
	op, payload, err := readMessage(c.br, make([]byte, max(1024, c.maxFrame)), max(1024, c.maxMessage), c.allowUnmaskedReads)
	if err == nil {
		obsx.ObserveWSFrame("in", op, len(payload))
	}
	return op, payload, err
}

// WriteMessage writes a single frame for small messages; text requires utf8 validity.
func (c *Conn) WriteMessage(op byte, payload []byte) error {
	if op == 0x1 && !utf8.Valid(payload) {
		return errors.New("utf8 invalid")
	}
	if c.writeTO > 0 {
		_ = c.c.SetWriteDeadline(time.Now().Add(c.writeTO))
	}
	return writeFrame(c.bw, op, payload, c.maskWrites)
}

// MaxMessage returns the configured maximum message size in bytes.
func (c *Conn) MaxMessage() int { return max(1024, c.maxMessage) }

// NetConn exposes the underlying network connection for advanced integrations.
func (c *Conn) NetConn() net.Conn { return c.c }

// Dial establishes a client-side RFC 6455 connection.
func Dial(ctx context.Context, rawURL string, opts DialOptions) (*Conn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return nil, fmt.Errorf("unsupported websocket scheme %q", u.Scheme)
	}

	addr := u.Host
	if _, _, err := net.SplitHostPort(addr); err != nil {
		switch scheme {
		case "wss":
			addr = net.JoinHostPort(addr, "443")
		default:
			addr = net.JoinHostPort(addr, "80")
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header = make(http.Header)
	for k, vals := range opts.Headers {
		req.Header[k] = append([]string(nil), vals...)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	if opts.Origin != "" {
		req.Header.Set("Origin", opts.Origin)
	}
	if len(opts.Protocols) > 0 {
		req.Header.Set("Sec-WebSocket-Protocol", strings.Join(opts.Protocols, ", "))
	}
	if err := validateDialHeaders(req.Header); err != nil {
		return nil, err
	}

	dialCtx := ctx
	var cancel context.CancelFunc
	if opts.HandshakeTimeout > 0 {
		dialCtx, cancel = context.WithTimeout(ctx, opts.HandshakeTimeout)
		defer cancel()
	}

	var conn net.Conn
	switch scheme {
	case "wss":
		tlsDialer := &tls.Dialer{NetDialer: &net.Dialer{}}
		conn, err = tlsDialer.DialContext(dialCtx, "tcp", addr)
	default:
		d := &net.Dialer{}
		conn, err = d.DialContext(dialCtx, "tcp", addr)
	}
	if err != nil {
		return nil, err
	}

	br := bufio.NewReader(conn)
	bw := bufio.NewWriter(conn)

	var keyBytes [16]byte
	if _, err := rand.Read(keyBytes[:]); err != nil {
		_ = conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes[:])

	target := u.RequestURI()
	if target == "" {
		target = "/"
	}
	host := u.Host
	if host == "" {
		host = addr
	}
	req.Header.Set("Host", host)
	req.Header.Set("Sec-WebSocket-Key", key)

	if _, err := bw.WriteString(http.MethodGet + " " + target + " HTTP/1.1\r\n"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	keys := make([]string, 0, len(req.Header))
	for k := range req.Header {
		if strings.EqualFold(k, "Host") {
			continue
		}
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if _, err := bw.WriteString("Host: " + host + "\r\n"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	for _, k := range keys {
		for _, v := range req.Header.Values(k) {
			if _, err := bw.WriteString(k + ": " + v + "\r\n"); err != nil {
				_ = conn.Close()
				return nil, err
			}
		}
	}
	if _, err := bw.WriteString("\r\n"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := bw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}

	resp, err := http.ReadResponse(br, req)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
		_ = conn.Close()
		return nil, fmt.Errorf("websocket handshake failed: status %d", resp.StatusCode)
	}
	if !strings.EqualFold(strings.TrimSpace(resp.Header.Get("Upgrade")), "websocket") {
		_ = conn.Close()
		return nil, errors.New("websocket handshake failed: missing upgrade header")
	}
	if got := strings.TrimSpace(resp.Header.Get("Sec-WebSocket-Accept")); got != computeAccept(key) {
		_ = conn.Close()
		return nil, errors.New("websocket handshake failed: invalid accept key")
	}

	return newConn(conn, br, bw, Options{
		MaxFrame:     opts.MaxFrame,
		MaxMessage:   opts.MaxMessage,
		ReadTimeout:  opts.ReadTimeout,
		WriteTimeout: opts.WriteTimeout,
	}, true, true), nil
}

func validateDialHeaders(headers http.Header) error {
	for key, values := range headers {
		if !isValidHeaderName(key) {
			return fmt.Errorf("invalid websocket header name %q", key)
		}
		for _, value := range values {
			if !isValidHeaderValue(value) {
				return fmt.Errorf("invalid websocket header value for %q", key)
			}
		}
	}
	return nil
}

func isValidHeaderName(value string) bool {
	if value == "" {
		return false
	}
	for i := 0; i < len(value); i++ {
		if !isTokenByte(value[i]) {
			return false
		}
	}
	return true
}

func isTokenByte(b byte) bool {
	switch {
	case '0' <= b && b <= '9':
		return true
	case 'a' <= b && b <= 'z':
		return true
	case 'A' <= b && b <= 'Z':
		return true
	}
	switch b {
	case '!', '#', '$', '%', '&', '\'', '*', '+', '-', '.', '^', '_', '`', '|', '~':
		return true
	}
	return false
}

func isValidHeaderValue(value string) bool {
	for i := 0; i < len(value); i++ {
		b := value[i]
		if b == '\r' || b == '\n' || b == 0 {
			return false
		}
		if b < 0x20 && b != '\t' {
			return false
		}
		if b == 0x7f {
			return false
		}
	}
	return true
}

func computeAccept(key string) string {
	h := sha1.Sum([]byte(key + wsGUID)) //nolint:gosec // SHA-1 required by RFC 6455
	return base64.StdEncoding.EncodeToString(h[:])
}

func chooseSubprotocol(header string, allowed []string) string {
	req := strings.Split(header, ",")
	for i := range req {
		req[i] = strings.TrimSpace(req[i])
	}
	if len(allowed) > 0 {
		for _, rp := range req {
			if slices.Contains(allowed, rp) {
				return rp
			}
		}
		return ""
	}
	for _, rp := range req {
		if isGeneratedAuthProtocol(rp) {
			return rp
		}
	}
	return ""
}

func isGeneratedAuthProtocol(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), "genapi.auth.")
}

// readMessage assembles a full message from possibly fragmented frames.
func readMessage(br *bufio.Reader, scratch []byte, maxMsg int, allowUnmasked bool) (byte, []byte, error) {
	first := true
	var opcode byte
	var assembled []byte
	for {
		fin, op, pl, err := readFrame(br, scratch, maxMsg, first, allowUnmasked)
		if err != nil {
			return 0, nil, err
		}
		if op == 0x9 || op == 0xA { // ping/pong passthrough for caller
			return op, pl, nil
		}
		if op == 0x8 {
			return op, nil, io.EOF
		}
		if first {
			opcode = op
			if opcode != 0x1 && opcode != 0x2 {
				return 0, nil, ErrInvalidOpcode
			}
		} else if op != 0x0 {
			return 0, nil, ErrInvalidOpcode
		}
		assembled = append(assembled, pl...)
		if len(assembled) > maxMsg {
			return 0, nil, ErrFrameTooLarge
		}
		if fin {
			if opcode == 0x1 && !utf8.Valid(assembled) {
				return 0, nil, errors.New("utf8 invalid")
			}
			return opcode, assembled, nil
		}
		first = false
	}
}

// readFrame parses a single frame. When allowUnmasked is false, masking is
// required per RFC 6455 (client→server). When true, unmasked frames are
// accepted — this is used for in-memory pipes where both sides are peers.
func readFrame(br *bufio.Reader, scratch []byte, max int, first bool, allowUnmasked bool) (bool, byte, []byte, error) {
	b1, err := br.ReadByte()
	if err != nil {
		return false, 0, nil, err
	}
	b2, err := br.ReadByte()
	if err != nil {
		return false, 0, nil, err
	}
	fin := (b1 & 0x80) != 0
	rsv := b1 & 0x70
	if rsv != 0 {
		return false, 0, nil, errors.New("reserved bits set")
	}
	op := b1 & 0x0F
	if op > 0xA {
		return false, 0, nil, ErrInvalidOpcode
	}
	masked := (b2 & 0x80) != 0
	if !masked && !allowUnmasked {
		return false, 0, nil, errors.New("client frames must be masked")
	}
	ln := int(b2 & 0x7F)
	switch ln {
	case 126:
		b := make([]byte, 2)
		if _, err := io.ReadFull(br, b); err != nil {
			return false, 0, nil, err
		}
		ln = int(b[0])<<8 | int(b[1])
	case 127:
		return false, 0, nil, ErrFrameTooLarge
	}
	if ln > len(scratch) || ln > max {
		return false, 0, nil, ErrFrameTooLarge
	}
	if masked {
		mask := make([]byte, 4)
		if _, err := io.ReadFull(br, mask); err != nil {
			return false, 0, nil, err
		}
		payload := scratch[:ln]
		if _, err := io.ReadFull(br, payload); err != nil {
			return false, 0, nil, err
		}
		for i := 0; i < ln; i++ {
			payload[i] ^= mask[i%4]
		}
		return fin, op, append([]byte(nil), payload...), nil
	}
	payload := scratch[:ln]
	if _, err := io.ReadFull(br, payload); err != nil {
		return false, 0, nil, err
	}
	return fin, op, append([]byte(nil), payload...), nil
}

func writeFrame(bw *bufio.Writer, op byte, payload []byte, mask bool) error {
	if err := bw.WriteByte(0x80 | (op & 0x0F)); err != nil {
		return err
	}
	ln := len(payload)
	switch {
	case ln < 126:
		hdr := byte(ln)
		if mask {
			hdr |= 0x80
		}
		if err := bw.WriteByte(hdr); err != nil {
			return err
		}
	case ln <= 0xFFFF:
		hdr := byte(126)
		if mask {
			hdr |= 0x80
		}
		if err := bw.WriteByte(hdr); err != nil {
			return err
		}
		if err := bw.WriteByte(byte(ln >> 8)); err != nil {
			return err
		}
		if err := bw.WriteByte(byte(ln & 0xFF)); err != nil {
			return err
		}
	default:
		return ErrFrameTooLarge
	}
	if mask {
		var maskKey [4]byte
		if _, err := rand.Read(maskKey[:]); err != nil {
			return err
		}
		if _, err := bw.Write(maskKey[:]); err != nil {
			return err
		}
		masked := make([]byte, ln)
		for i := 0; i < ln; i++ {
			masked[i] = payload[i] ^ maskKey[i%4]
		}
		if ln > 0 {
			if _, err := bw.Write(masked); err != nil {
				return err
			}
		}
	} else if ln > 0 {
		if _, err := bw.Write(payload); err != nil {
			return err
		}
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	obsx.ObserveWSFrame("out", op, ln)
	return nil
}
