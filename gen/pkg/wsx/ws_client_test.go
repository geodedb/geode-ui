package wsx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDial_UpgradeAndEcho(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Upgrade(w, r, Options{
			Protocols:  []string{"events.v1"},
			MaxFrame:   4096,
			MaxMessage: 4096,
		})
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer func() { _ = conn.Close() }()

		op, msg, err := conn.ReadMessage()
		if err != nil {
			t.Errorf("read: %v", err)
			return
		}
		if err := conn.WriteMessage(op, msg); err != nil {
			t.Errorf("write echo: %v", err)
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, err := Dial(context.Background(), wsURL, DialOptions{
		Protocols:  []string{"events.v1"},
		MaxFrame:   4096,
		MaxMessage: 4096,
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.WriteMessage(0x1, []byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	op, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if op != 0x1 {
		t.Fatalf("opcode: got %d want 1", op)
	}
	if string(msg) != "hello" {
		t.Fatalf("message: got %q", string(msg))
	}
}

func TestDial_RejectsInvalidScheme(t *testing.T) {
	if _, err := Dial(context.Background(), "http://example.com/ws", DialOptions{}); err == nil {
		t.Fatal("expected invalid scheme error")
	}
}

func TestDial_RejectsHeaderInjection(t *testing.T) {
	t.Parallel()

	if _, err := Dial(context.Background(), "ws://127.0.0.1:1/ws", DialOptions{
		Headers: http.Header{
			"X-Test": []string{"ok\r\nX-Evil: injected"},
		},
	}); err == nil {
		t.Fatal("expected invalid header value error")
	}

	if _, err := Dial(context.Background(), "ws://127.0.0.1:1/ws", DialOptions{
		Origin: "https://app.example.com\r\nX-Evil: injected",
	}); err == nil {
		t.Fatal("expected invalid origin header error")
	}
}
