package server

import (
	"encoding/json"
	"testing"
)

// TestQueryStreamMsg_JSON exercises the round-trip through the json
// tags: required field present, omitempty fields absent, and the
// {"kind":"end"} compact-marshal invariant the streaming protocol
// relies on (one frame per state, smallest payload).
func TestQueryStreamMsg_JSON(t *testing.T) {
	in := queryStreamMsg{
		Kind:      "start",
		Statement: "MATCH (n) RETURN n",
		Graph:     "social",
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out queryStreamMsg
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Kind != in.Kind || out.Statement != in.Statement || out.Graph != in.Graph {
		t.Fatalf("round-trip mismatch: %+v", out)
	}

	end := queryStreamMsg{Kind: "end"}
	endData, err := json.Marshal(end)
	if err != nil {
		t.Fatalf("marshal end: %v", err)
	}
	if string(endData) != `{"kind":"end"}` {
		t.Fatalf("end marshal=%s want {\"kind\":\"end\"}", string(endData))
	}
}

// TestStringsToAny verifies the column-name → []any helper used to
// shape the schema frame's "columns" payload.
func TestStringsToAny(t *testing.T) {
	got := stringsToAny([]string{"a", "b"})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("stringsToAny: %v", got)
	}
	if empty := stringsToAny(nil); len(empty) != 0 {
		t.Fatalf("stringsToAny(nil)=%v want empty", empty)
	}
}

// TestMapToNamedArgs_Empty: nil/empty params must yield (nil, nil) so
// the handler can pass the result straight to db.QueryContext.
func TestMapToNamedArgs_Empty(t *testing.T) {
	args, err := mapToNamedArgs(nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if args != nil {
		t.Fatalf("args=%v want nil", args)
	}
	args, err = mapToNamedArgs(map[string]any{})
	if err != nil {
		t.Fatalf("err empty map: %v", err)
	}
	if args != nil {
		t.Fatalf("args empty map=%v want nil", args)
	}
}

// TestMapToNamedArgs_Values: a populated params map yields one entry
// per key. We don't assert ordering — Go map iteration is intentionally
// randomized — but we do assert length.
func TestMapToNamedArgs_Values(t *testing.T) {
	args, err := mapToNamedArgs(map[string]any{"x": 1, "name": "alice"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(args) != 2 {
		t.Fatalf("args len=%d want 2", len(args))
	}
}
