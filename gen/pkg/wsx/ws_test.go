package wsx

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
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

	if _, err := Upgrade(httptest.NewRecorder(), req, Options{CheckOrigin: true}); err == nil || err.Error() != "forbidden origin" {
		t.Fatalf("expected forbidden origin error, got %v", err)
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
