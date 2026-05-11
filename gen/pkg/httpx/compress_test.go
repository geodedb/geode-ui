package httpx

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func bigJSON(n int) string {
	var b strings.Builder
	b.WriteString(`{"items":[`)
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`"row-value-padding-to-make-it-compressible"`)
	}
	b.WriteString(`]}`)
	return b.String()
}

func TestGzip_CompressesLargeJSON(t *testing.T) {
	payload := bigJSON(200) // well over 1 KiB
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("Vary missing Accept-Encoding: %q", w.Header().Get("Vary"))
	}
	if w.Header().Get("Content-Length") != "" {
		t.Fatalf("Content-Length should be cleared after compression, got %q", w.Header().Get("Content-Length"))
	}
	gz, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	dec, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if string(dec) != payload {
		t.Fatalf("decompressed body mismatch")
	}
	if len(w.Body.Bytes()) >= len(payload) {
		t.Fatalf("compressed body (%d) not smaller than original (%d)", len(w.Body.Bytes()), len(payload))
	}
}

func TestGzip_SkipsWhenClientDoesNotAccept(t *testing.T) {
	payload := bigJSON(200)
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("must not compress without Accept-Encoding: gzip")
	}
	if w.Body.String() != payload {
		t.Fatal("body altered")
	}
}

func TestGzip_SkipsTinyBody(t *testing.T) {
	const small = `{"ok":true}`
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, small)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("must not compress sub-1KiB body")
	}
	if w.Body.String() != small {
		t.Fatalf("body altered: %q", w.Body.String())
	}
}

func TestGzip_SkipsBinaryContentType(t *testing.T) {
	payload := bytes.Repeat([]byte{0xFF, 0x00, 0x12}, 2000) // >1 KiB binary
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/img", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("must not compress image/png")
	}
	if !bytes.Equal(w.Body.Bytes(), payload) {
		t.Fatal("binary body altered")
	}
}

func TestGzip_SkipsAlreadyEncoded(t *testing.T) {
	payload := bigJSON(200)
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "br")
		_, _ = io.WriteString(w, payload)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") != "br" {
		t.Fatalf("Content-Encoding = %q, want br (untouched)", w.Header().Get("Content-Encoding"))
	}
}

func TestGzip_PassthroughNoContentNoBody(t *testing.T) {
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/x", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	if w.Header().Get("Content-Encoding") == "gzip" {
		t.Fatal("204 must not be gzipped")
	}
}
