package mcpx

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"strings"
	"testing"
)

// TestSTDIO_NewlineDelimited verifies that STDIO JSON-RPC messages are
// newline-delimited (each response ends with \n).
func TestSTDIO_NewlineDelimited(t *testing.T) {
	tools := map[string]Tool{
		"echo": func(_ context.Context, p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}

	req := `{"jsonrpc":"2.0","id":1,"method":"ping"}` + "\n"
	in := strings.NewReader(req)
	var out bytes.Buffer

	err := serveSTDIOWith(in, &out, tools)
	if err != nil {
		t.Fatalf("serveSTDIOWith: %v", err)
	}

	raw := out.String()
	if !strings.HasSuffix(raw, "\n") {
		t.Errorf("STDIO response missing trailing newline: %q", raw)
	}

	lines := strings.Split(strings.TrimRight(raw, "\n"), "\n")
	for i, line := range lines {
		if !jsontext.Value(line).IsValid() {
			t.Errorf("line %d is not valid JSON: %q", i, line)
		}
	}
}

// TestJsontextValue_RoundTrip verifies that jsontext.Value round-trips
// correctly through MCP tool dispatch.
func TestJsontextValue_RoundTrip(t *testing.T) {
	payload := `{"key":"value","num":42,"nested":{"a":true}}`

	tools := map[string]Tool{
		"echo": func(_ context.Context, p jsontext.Value) (jsontext.Value, error) { return p, nil },
	}

	req := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","params":` + payload + `}}` + "\n"
	in := strings.NewReader(req)
	var out bytes.Buffer

	err := serveSTDIOWith(in, &out, tools)
	if err != nil {
		t.Fatalf("serveSTDIOWith: %v", err)
	}

	var resp struct {
		Result jsontext.Value `json:"result"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out.String())), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	// The result should contain our original payload data
	var original, returned map[string]any
	if err := json.Unmarshal([]byte(payload), &original); err != nil {
		t.Fatalf("unmarshal original: %v", err)
	}
	if err := json.Unmarshal(resp.Result, &returned); err != nil {
		t.Fatalf("unmarshal returned: %v", err)
	}
	if returned["key"] != original["key"] || returned["num"] != original["num"] {
		t.Errorf("round-trip mismatch: got %v, want %v", returned, original)
	}
}
