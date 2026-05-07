package wsx

import (
	"net"
	"testing"
)

func TestNewConnPipe(t *testing.T) {
	a, b := net.Pipe()
	connA := NewConn(a, Options{MaxFrame: 4096, MaxMessage: 4096})
	connB := NewConn(b, Options{MaxFrame: 4096, MaxMessage: 4096})

	done := make(chan error, 1)
	go func() {
		done <- connA.WriteMessage(0x1, []byte("hello"))
	}()

	op, data, err := connB.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if op != 0x1 {
		t.Errorf("opcode: got %d, want 1", op)
	}
	if string(data) != "hello" {
		t.Errorf("data: got %q, want %q", data, "hello")
	}

	// Wait for the writer goroutine to finish before closing.
	if err := <-done; err != nil {
		t.Fatalf("WriteMessage: %v", err)
	}

	_ = connA.Close()
	_ = connB.Close()
}
