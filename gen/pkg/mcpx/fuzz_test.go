//go:build fuzz

package mcpx

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"testing"
)

// FuzzJSONRPC exercises the HTTP JSON-RPC handler with random inputs.
func FuzzJSONRPC(f *testing.F) {
	installHeaderAuthVerifier(f)
	// Seed corpus with a few valid requests
	seed := []map[string]any{
		{"jsonrpc": "2.0", "id": 1, "method": "ping"},
		{"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
		{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": map[string]any{"name": "echo", "params": map[string]any{"msg": "x"}}},
	}
	tools := map[string]Tool{
		"echo": func(p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	for _, s := range seed {
		b, _ := json.Marshal(s)
		f.Add(string(b))
	}
	f.Fuzz(func(t *testing.T, body string) {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewBufferString(body))
		r.Header.Set("Authorization", "Bearer fuzz")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		// Handler should never panic; status may vary
		_ = w.Code
	})
}
