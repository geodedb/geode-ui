package gen

import (
	"strings"
	"testing"
)

func TestFileUpload_Read(t *testing.T) {
	fu := &FileUpload{
		Filename:    "test.png",
		Size:        5,
		ContentType: "image/png",
		Reader:      strings.NewReader("hello"),
	}
	if fu.Filename != "test.png" {
		t.Fatalf("expected test.png, got %s", fu.Filename)
	}
	if fu.Size != 5 {
		t.Fatalf("expected size 5, got %d", fu.Size)
	}
	if fu.ContentType != "image/png" {
		t.Fatalf("expected image/png, got %s", fu.ContentType)
	}
	buf := make([]byte, 5)
	n, err := fu.Reader.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if n != 5 || string(buf) != "hello" {
		t.Fatalf("expected hello, got %s", string(buf[:n]))
	}
}
