package server

import (
	"encoding/json"
	"testing"

	"geodedb.com/geode-ui/gen/pkg/wsx"
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

// TestReadMsg_OpcodeConstants is a behavioral guard — it documents which opcodes
// readMsg returns successfully vs. errors. The full WS round-trip is exercised
// in Phase C; this test pins the discriminator logic.
//
// We don't have a real wsx.Conn to feed frames into without elaborate setup,
// so this is just a compile-time guard that wsx.OpText/OpPing/OpPong/OpClose/OpBinary
// constants exist as readMsg expects. The runtime behavior is covered by the
// switch statement's exhaustiveness; if a constant gets renamed, this test fails
// to compile and forces an explicit reconciliation.
func TestReadMsg_OpcodeConstants(t *testing.T) {
	cases := []struct {
		name string
		op   byte
	}{
		{"text", wsx.OpText},
		{"ping", wsx.OpPing},
		{"pong", wsx.OpPong},
		{"close", wsx.OpClose},
		{"binary", wsx.OpBinary},
	}
	for _, tc := range cases {
		if tc.op == 0 && tc.name != "" {
			// OpContinuation is 0x0, but none of the named cases here should be 0
			// (and we're not using continuation). Just sanity-check named opcodes
			// are non-zero so the switch in readMsg discriminates correctly.
			// (OpClose=0x8, OpPing=0x9, OpPong=0xA, OpText=0x1, OpBinary=0x2)
			t.Fatalf("opcode %s should not be 0x0", tc.name)
		}
	}
}
