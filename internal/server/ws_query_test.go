package server

import (
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
)

// fakeFrameWriter records every WriteMessage payload so tests can assert
// frame counts and per-frame contents without spinning up a wsx.Conn.
type fakeFrameWriter struct {
	frames [][]byte
}

func (f *fakeFrameWriter) WriteMessage(op byte, payload []byte) error {
	if op != wsx.OpText {
		return nil
	}
	cp := make([]byte, len(payload))
	copy(cp, payload)
	f.frames = append(f.frames, cp)
	return nil
}

// TestRowBatcher_BatchingFramesLessThanRows verifies PERF-F2 (issue #21):
// when N rows pass through the batcher with batch size B, the writer
// receives ceil(N/B) frames -- strictly fewer than N for any N > B.
//
// This is the canary regression test for the batching optimisation.
func TestRowBatcher_BatchingFramesLessThanRows(t *testing.T) {
	const rowCount = 200
	w := &fakeFrameWriter{}
	b := newRowBatcher(w, wsRowBatchSize)
	for i := range rowCount {
		if err := b.add([]any{int64(i), "x"}); err != nil {
			t.Fatalf("add row %d: %v", i, err)
		}
	}
	if err := b.flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if len(w.frames) >= rowCount {
		t.Fatalf("frames=%d rowCount=%d -- expected batching to reduce frame count below row count",
			len(w.frames), rowCount)
	}
	wantFrames := (rowCount + wsRowBatchSize - 1) / wsRowBatchSize
	if len(w.frames) != wantFrames {
		t.Fatalf("frames=%d want %d (ceil(%d/%d))",
			len(w.frames), wantFrames, rowCount, wsRowBatchSize)
	}
}

// TestRowBatcher_FrameSchema verifies the on-the-wire shape: each batch
// frame is a {"kind":"rows","rows":[[...],[...]]} envelope. The client
// (queryStream.ts) decomposes these back into individual row callbacks
// so QueryPage and existing tests keep working.
func TestRowBatcher_FrameSchema(t *testing.T) {
	w := &fakeFrameWriter{}
	b := newRowBatcher(w, 4)
	for i := range 6 {
		if err := b.add([]any{int64(i)}); err != nil {
			t.Fatalf("add: %v", err)
		}
	}
	if err := b.flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := len(w.frames); got != 2 {
		t.Fatalf("frames=%d want 2 (4-batch + 2-residual)", got)
	}

	var first struct {
		Kind string  `json:"kind"`
		Rows [][]any `json:"rows"`
	}
	if err := json.Unmarshal(w.frames[0], &first); err != nil {
		t.Fatalf("first frame parse: %v", err)
	}
	if first.Kind != "rows" {
		t.Fatalf("first.Kind=%q want rows", first.Kind)
	}
	if len(first.Rows) != 4 {
		t.Fatalf("first.Rows len=%d want 4", len(first.Rows))
	}

	var second struct {
		Kind string  `json:"kind"`
		Rows [][]any `json:"rows"`
	}
	if err := json.Unmarshal(w.frames[1], &second); err != nil {
		t.Fatalf("second frame parse: %v", err)
	}
	if len(second.Rows) != 2 {
		t.Fatalf("second.Rows len=%d want 2 (residual)", len(second.Rows))
	}
}

// TestRowBatcher_FlushIsIdempotent verifies that calling flush() with an
// empty buffer is a no-op (no zero-row frames). Important so the
// end-of-stream flush in Query() doesn't write spurious empty batches
// when the result set's row count is an exact multiple of the batch
// size.
func TestRowBatcher_FlushIsIdempotent(t *testing.T) {
	w := &fakeFrameWriter{}
	b := newRowBatcher(w, 4)
	for i := range 4 {
		_ = b.add([]any{int64(i)})
	}
	// First flush: should NOT emit an extra frame because the batch
	// auto-flushed when it filled. Second flush: must be a no-op.
	if err := b.flush(); err != nil {
		t.Fatalf("flush 1: %v", err)
	}
	frameCountAfterFirstFlush := len(w.frames)
	if err := b.flush(); err != nil {
		t.Fatalf("flush 2: %v", err)
	}
	if len(w.frames) != frameCountAfterFirstFlush {
		t.Fatalf("flush is not idempotent: frames %d -> %d",
			frameCountAfterFirstFlush, len(w.frames))
	}
}

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

// TestStartCancelReader_ExitsOnDone is the Q40 (#151) regression guard:
// the cancel-reader coordinator goroutine must return promptly once the
// handler signals done (Query's `defer close(done)`), instead of staying
// parked in readMsg until the framework tears the conn down. We assert
// the coordinator's exit hook fires within a short timeout after done is
// closed, without ever sending it a frame. Run under -race this also
// catches a double-close of done or a panic on conn-already-closed.
func TestStartCancelReader_ExitsOnDone(t *testing.T) {
	a, b := net.Pipe()
	defer func() { _ = a.Close() }()
	conn := wsx.NewConn(b, wsx.Options{MaxFrame: 4096, MaxMessage: 4096})

	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	s := &WSServer{onCancelReaderExit: wg.Done}

	done := make(chan struct{})
	exited := s.startCancelReader(conn, cancel, done)

	// Happy path: the handler returns -> done is closed. The coordinator
	// must exit even though no frame ever arrived on the conn.
	close(done)

	exitDone := make(chan struct{})
	go func() { wg.Wait(); close(exitDone) }()
	select {
	case <-exitDone:
	case <-time.After(2 * time.Second):
		t.Fatal("cancel-reader coordinator did not exit within 2s of done being closed")
	}
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("startCancelReader exited channel not closed after coordinator returned")
	}
	// Closing the conn lets the bounded inner relay goroutine (parked in
	// readMsg) unwind too, so -race's leak/teardown checks stay clean.
	_ = conn.Close()
}

// TestStartCancelReader_CancelsOnError verifies the cancel-reader cancels
// the query context when the inbound side errors (peer close / EOF) — the
// db.QueryContext-abort path that lets a stuck or vanished client unwind
// the streaming handler.
func TestStartCancelReader_CancelsOnError(t *testing.T) {
	a, b := net.Pipe()
	conn := wsx.NewConn(b, wsx.Options{MaxFrame: 4096, MaxMessage: 4096})

	ctx, cancel := context.WithCancel(context.Background())
	s := &WSServer{}
	done := make(chan struct{})
	defer close(done)
	s.startCancelReader(conn, cancel, done)

	// Drop the peer: readMsg returns an error, the coordinator must call
	// cancel().
	_ = a.Close()
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("cancel-reader did not cancel ctx after peer dropped")
	}
	_ = conn.Close()
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
