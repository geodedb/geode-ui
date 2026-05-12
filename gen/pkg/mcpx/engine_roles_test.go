package mcpx

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// driveToolCall sends one tools/call JSON-RPC request through HandleHTTP
// with a verifier that injects callerRoles into the request context, and
// returns the decoded response envelope.
func driveToolCall(t *testing.T, callerRoles []string, tools map[string]Tool, tool string) map[string]any {
	t.Helper()
	SetAuthVerifier(func(r *http.Request) (context.Context, error) {
		return ContextWithRoles(r.Context(), callerRoles), nil
	})
	t.Cleanup(func() { SetAuthVerifier(nil) })

	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { HandleHTTP(w, r, tools) })
	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": tool}}
	b, _ := json.Marshal(req)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mcp", bytes.NewReader(b))
	r.Header.Set("Authorization", "Bearer x")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("HTTP code %d body %q", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (%q)", err, w.Body.String())
	}
	return out
}

func TestToolRoles_SufficientRoleDispatches(t *testing.T) {
	t.Cleanup(func() { SetToolRoles(nil) })
	SetToolRoles(map[string][]string{"adminTool": {"admin", "owner"}})
	ran := false
	tools := map[string]Tool{
		"adminTool": func(_ context.Context, _ jsontext.Value) (jsontext.Value, error) {
			ran = true
			return jsontext.Value("true"), nil
		},
	}
	out := driveToolCall(t, []string{"reader", "admin"}, tools, "adminTool")
	if !ran {
		t.Fatal("tool body did not run despite caller having a sufficient role")
	}
	if _, isErr := out["error"]; isErr {
		t.Fatalf("expected success, got error: %#v", out)
	}
}

func TestToolRoles_InsufficientRoleDenied(t *testing.T) {
	t.Cleanup(func() { SetToolRoles(nil) })
	SetToolRoles(map[string][]string{"adminTool": {"admin"}})
	ran := false
	tools := map[string]Tool{
		"adminTool": func(_ context.Context, _ jsontext.Value) (jsontext.Value, error) {
			ran = true
			return jsontext.Value("true"), nil
		},
	}
	out := driveToolCall(t, []string{"reader"}, tools, "adminTool")
	if ran {
		t.Fatal("tool body ran despite caller lacking the required role")
	}
	errObj, isErr := out["error"].(map[string]any)
	if !isErr {
		t.Fatalf("expected a JSON-RPC error, got: %#v", out)
	}
	if msg, _ := errObj["message"].(string); !strings.Contains(msg, "insufficient role") {
		t.Fatalf("error message = %q, want it to mention insufficient role", msg)
	}
}

func TestToolRoles_NoPolicyDispatches(t *testing.T) {
	t.Cleanup(func() { SetToolRoles(nil) })
	SetToolRoles(map[string][]string{"adminTool": {"admin"}}) // unrelated entry
	ran := false
	tools := map[string]Tool{
		"openTool": func(_ context.Context, _ jsontext.Value) (jsontext.Value, error) {
			ran = true
			return jsontext.Value("true"), nil
		},
	}
	out := driveToolCall(t, nil, tools, "openTool")
	if !ran {
		t.Fatal("tool with no role policy was blocked")
	}
	if _, isErr := out["error"]; isErr {
		t.Fatalf("expected success, got error: %#v", out)
	}
}

func TestRolesContextRoundTrip(t *testing.T) {
	if got := RolesFromContext(context.Background()); got != nil {
		t.Fatalf("RolesFromContext on bare ctx = %v, want nil", got)
	}
	ctx := ContextWithRoles(context.Background(), []string{"a", "b"})
	if got := RolesFromContext(ctx); len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("RolesFromContext = %v, want [a b]", got)
	}
}
