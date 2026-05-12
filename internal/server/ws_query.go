// Package server: WebSocket streaming query handler.
//
// /ws/query is the streaming counterpart to POST /api/v1/query. The
// client sends one {kind:"start", statement, ...} message; the server
// replies with one {kind:"schema", columns}, then many {kind:"row", row}
// frames as the underlying database cursor advances, then a final
// {kind:"summary", row_count, elapsed_ms} and {kind:"end"}. The client
// may at any time send {kind:"cancel"} to abort an in-flight query.
//
// The handler lives on its own *WSServer struct rather than on
// *GraphServer because the genapi method-name policy emits "Query" for
// path "/ws/query" — which would collide with the existing Query method
// satisfying the synchronous API ServerInterface. Splitting the
// surfaces also matches the conceptual difference: REST returns a
// completed result; WS streams an in-progress one.
package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
	genws "geodedb.com/geode-ui/gen/ws"
)

// wsRowBatchSize is the number of rows packed into a single WebSocket
// "rows" frame. Sized for a typical interactive query: 64 keeps frame
// payloads small enough that the browser's WS message handler stays
// responsive (microsecond range) while amortising the syscall and
// QUIC-stream overhead of WriteMessage across an order of magnitude
// fewer frames. PERF-F2 / issue #21.
const wsRowBatchSize = 64

// wsRowBufPool reuses bytes.Buffer instances for marshalling row
// batches so the per-batch JSON encoding does not allocate a fresh
// backing slice for every flush. Buffers are reset (not nil-cleared)
// on Get so callers can append directly.
var wsRowBufPool = sync.Pool{
	New: func() any { return &bytes.Buffer{} },
}

// frameWriter is the WriteMessage subset of *wsx.Conn that the row
// batcher exercises. Hoisting it as an interface lets ws_query_test
// substitute a counter without spinning up a real WS connection.
type frameWriter interface {
	WriteMessage(op byte, payload []byte) error
}

// rowBatcher coalesces individual row scans into batched
// {"kind":"rows","rows":[[...],...]} frames so the WS hot loop emits
// ceil(N/B) frames for N rows instead of N. Each batch is marshalled
// using a sync.Pool-backed bytes.Buffer.
//
// Concurrency: rowBatcher is single-writer. Query() owns the only
// instance and the cancel-reader goroutine never touches it.
type rowBatcher struct {
	w        frameWriter
	cap      int
	buf      [][]any
	envelope batchEnvelope
}

// batchEnvelope is the on-the-wire shape of a batched-rows frame. It
// is structurally identical to the queryStreamMsg{Kind:"rows",...}
// branch but kept narrow so json.Marshal does not pull in every
// optional field of queryStreamMsg.
type batchEnvelope struct {
	Kind string  `json:"kind"`
	Rows [][]any `json:"rows"`
}

// newRowBatcher returns a batcher that flushes when its row buffer
// reaches batchSize. Each batcher is single-use per query and is
// drained at end-of-stream by the caller via flush().
func newRowBatcher(w frameWriter, batchSize int) *rowBatcher {
	if batchSize <= 0 {
		batchSize = wsRowBatchSize
	}
	return &rowBatcher{
		w:   w,
		cap: batchSize,
		buf: make([][]any, 0, batchSize),
	}
}

// add appends one scanned row to the current batch, auto-flushing
// when the batch fills. The caller MUST treat row as immutable after
// add (the rows are referenced until the next flush completes); the
// production hot path materialises a fresh []any per scan to satisfy
// this.
func (b *rowBatcher) add(row []any) error {
	b.buf = append(b.buf, row)
	if len(b.buf) >= b.cap {
		return b.flush()
	}
	return nil
}

// flush emits the current batch as a single "rows" frame and resets
// the buffer. A flush with an empty buffer is a no-op so end-of-stream
// drains do not produce zero-row frames.
func (b *rowBatcher) flush() error {
	if len(b.buf) == 0 {
		return nil
	}
	buf := wsRowBufPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer wsRowBufPool.Put(buf)

	b.envelope.Kind = "rows"
	b.envelope.Rows = b.buf
	enc := json.NewEncoder(buf)
	if err := enc.Encode(&b.envelope); err != nil {
		// Reset before bailing so a partial batch is not retried.
		b.buf = b.buf[:0]
		return err
	}
	// json.Encoder appends a trailing newline; trim it so the WS
	// payload is a clean JSON document the client's JSON.parse can
	// consume directly.
	payload := buf.Bytes()
	if n := len(payload); n > 0 && payload[n-1] == '\n' {
		payload = payload[:n-1]
	}
	err := b.w.WriteMessage(wsx.OpText, payload)
	b.buf = b.buf[:0]
	return err
}

// WSServer implements the generated genws.WSServerInterface. It carries
// the same Config as *GraphServer so it can reach the connection pool
// and any future cross-cutting dependencies (auth claims context keys,
// audit logger, etc.). It does NOT embed GraphServer — the WS surface
// has its own method-naming rules and we don't want to leak API
// methods into it accidentally.
type WSServer struct {
	genws.UnimplementedWSServer
	cfg Config

	// onCancelReaderExit, when non-nil, is invoked by the cancel-reader
	// coordinator goroutine just before it returns. It exists solely so
	// tests can deterministically observe goroutine teardown (e.g. via a
	// sync.WaitGroup.Done) without racing on runtime.NumGoroutine. It is
	// never set in production.
	onCancelReaderExit func()
}

// NewWSServer constructs a WSServer sharing cfg with the API server.
func NewWSServer(cfg Config) *WSServer {
	return &WSServer{cfg: cfg}
}

// queryStreamMsg mirrors the QueryStreamMsg schema in geode.json. The
// genapi types layer emits a generated Go type for it, but at the WS
// boundary the message is opaque JSON — we own the json.Marshal/
// Unmarshal directly so we can tolerate optional fields cleanly.
type queryStreamMsg struct {
	Kind      string         `json:"kind"`
	Statement string         `json:"statement,omitempty"`
	Graph     string         `json:"graph,omitempty"`
	Params    map[string]any `json:"params,omitempty"`
	Columns   []any          `json:"columns,omitempty"`
	Row       []any          `json:"row,omitempty"`
	ElapsedMs int64          `json:"elapsed_ms,omitempty"`
	RowCount  int64          `json:"row_count,omitempty"`
	Code      string         `json:"code,omitempty"`
	Message   string         `json:"message,omitempty"`
}

// Query implements genws.WSServerInterface for /ws/query.
//
// Method-name note: the generated interface emits "Query" (genapi
// strips the leading path segment, so /ws/query → Query), which is
// why this lives on *WSServer rather than *GraphServer.
//
// Stuck-client cleanup (PERF-F12 / #56): there is no server-wide write
// timeout on the /ws/ surface (a large MATCH legitimately streams for
// minutes — see cmd/server/main.go), so cleanup of a stuck peer relies
// on two things, both already in place:
//   - Per-frame deadlines: every conn.WriteMessage / conn.ReadMessage
//     below calls SetWriteDeadline / SetReadDeadline on the underlying
//     net.Conn (wsx.Conn does this when wsx.Options carries a non-zero
//     ReadTimeout/WriteTimeout, which gen/ws/ws_handlers.gen.go sets to
//     30s for every WS path). A client that stops draining trips that
//     deadline within 30s and rows.Next()'s next batcher flush returns
//     an error, unwinding this handler.
//   - Context cancellation: the cancel-reader goroutine below cancels
//     ctx on any read error, EOF, close frame, or {kind:"cancel"} — so
//     db.QueryContext is aborted promptly.
func (s *WSServer) Query(conn *wsx.Conn) error {
	if s.cfg.Pool == nil {
		return writeErr(conn, "internal", "pool not configured")
	}
	ctx, cancel := context.WithCancel(conn.Context())
	defer cancel()

	first, err := readMsg(conn)
	if err != nil {
		return err
	}
	if first.Kind != "start" || first.Statement == "" {
		return writeErr(conn, "bad_request", "first message must be kind=start with non-empty statement")
	}

	profileName := profileFromContextOrDefault(ctx)
	db, err := s.cfg.Pool.DB(profileName)
	if err != nil {
		return writeErr(conn, "profile_unreachable", err.Error())
	}

	stmt := first.Statement
	if first.Graph != "" {
		stmt = "USE GRAPH " + sanitizeGraphName(first.Graph) + "; " + stmt
	}

	// Spawn the cancel-reader: it watches for {kind:"cancel"}, a read
	// error, EOF, or a close frame and cancels the query context so
	// db.QueryContext aborts promptly. Closing done on return makes the
	// coordinator goroutine exit without waiting for the next frame.
	done := make(chan struct{})
	defer close(done)
	// production ignores the returned exited channel; the cancel-reader
	// coordinator's teardown is observable in tests via onCancelReaderExit.
	s.startCancelReader(conn, cancel, done)

	args, err := mapToNamedArgs(first.Params)
	if err != nil {
		return writeErr(conn, "invalid_params", err.Error())
	}

	start := time.Now()
	rows, err := db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return writeErr(conn, "query_error", err.Error())
	}
	defer func() { _ = rows.Close() }()

	cols, err := rows.Columns()
	if err != nil {
		return writeErr(conn, "internal", err.Error())
	}
	if err := writeMsg(conn, queryStreamMsg{Kind: "schema", Columns: stringsToAny(cols)}); err != nil {
		return err
	}

	// Row hot loop: batch up to wsRowBatchSize scans per WS frame so
	// 200 rows produce 4 frames instead of 200 (PERF-F2 / issue #21).
	// The batcher's marshal buffer comes from wsRowBufPool to avoid
	// per-batch heap churn under sustained streaming load.
	batcher := newRowBatcher(conn, wsRowBatchSize)
	count, err := streamRowsOverWS(conn, rows, cols, batcher)
	if err != nil {
		// errStreamAborted means a terminal frame was already written
		// successfully — the handler is done, with no transport error
		// to propagate (matches the pre-refactor `return writeErr(...)`).
		if errors.Is(err, errStreamAborted) {
			return nil
		}
		return err
	}
	if err := writeMsg(conn, queryStreamMsg{
		Kind:      "summary",
		RowCount:  count,
		ElapsedMs: time.Since(start).Milliseconds(),
	}); err != nil {
		return err
	}
	return writeMsg(conn, queryStreamMsg{Kind: "end"})
}

// readResult is the cancel-reader's relay payload: one decoded message
// (or the read error that ended the stream).
type readResult struct {
	msg queryStreamMsg
	err error
}

// errStreamAborted is the sentinel streamRowsOverWS returns after it has
// already emitted a terminal frame ("scan" / "canceled" / "query_error")
// to the client. Query treats any non-nil return from streamRowsOverWS as
// "stop, do not write summary/end"; this sentinel lets the caller tell a
// successful-error-frame write apart from a real frame-write failure
// without leaking it onto the wire.
var errStreamAborted = errors.New("ws: stream aborted (terminal frame already sent)")

// startCancelReader spawns the goroutine that watches the inbound side
// of a /ws/query connection and cancels the query context on the first
// {kind:"cancel"} message, read error, EOF, or close frame.
//
// Lifetime: the caller MUST `defer close(done)` so this returns on the
// happy path instead of blocking on the next readMsg until the framework
// tears the conn down. The coordinator goroutine selects between the
// relayed read result and <-done; once done closes it returns without
// touching conn (waking on <-done after the conn has been closed is fine
// — it just returns). cancel() is still called by Query's own defer
// regardless, so closing done here races nothing.
//
// A bounded inner relay goroutine performs the blocking readMsg; it too
// exits on <-done or on the first read error. It may briefly outlive the
// handler while parked in readMsg, but it shares no mutable state with
// the rest of Query and the conn lifetime bounds it.
//
// The returned exited channel is closed by the coordinator goroutine
// when it has fully returned; production ignores it, tests assert on it.
func (s *WSServer) startCancelReader(conn *wsx.Conn, cancel context.CancelFunc, done <-chan struct{}) <-chan struct{} {
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		if s.onCancelReaderExit != nil {
			defer s.onCancelReaderExit()
		}
		msgs := make(chan readResult, 1)
		go func() {
			for {
				m, err := readMsg(conn)
				select {
				case msgs <- readResult{msg: m, err: err}:
				case <-done:
					return
				}
				if err != nil {
					return
				}
			}
		}()
		for {
			select {
			case <-done:
				return
			case r := <-msgs:
				if r.err != nil {
					cancel()
					return
				}
				if r.msg.Kind == "cancel" {
					cancel()
					return
				}
			}
		}
	}()
	return exited
}

// streamRowsOverWS drives the rows cursor: it scans each row into a fresh
// []any (so the batcher may hold rows until its next flush), feeds the
// batcher, drains the residual partial batch, then reads rows.Err and
// reclassifies a context cancellation as the friendlier "canceled" frame.
// Returns the number of rows successfully streamed plus any frame-write
// or query error. On a scan failure it drains pending progress, emits the
// "scan" error frame, and returns its write result.
func streamRowsOverWS(conn *wsx.Conn, rows *sql.Rows, cols []string, batcher *rowBatcher) (int64, error) {
	var count int64
	for rows.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			// Drain any pending batch so partial progress reaches
			// the client before the error frame.
			_ = batcher.flush()
			if werr := writeErr(conn, "scan", err.Error()); werr != nil {
				return count, werr
			}
			return count, errStreamAborted
		}
		if err := batcher.add(row); err != nil {
			return count, err
		}
		count++
	}
	// Drain the residual partial batch before reading rows.Err so
	// the client sees every successfully-scanned row even if the
	// driver reports a late error or the context was cancelled.
	if err := batcher.flush(); err != nil {
		return count, err
	}
	if err := rows.Err(); err != nil {
		// Distinguish caller-initiated cancellation from a true
		// query failure so the client can surface a friendlier
		// message.
		code, msg := "query_error", err.Error()
		if errors.Is(err, context.Canceled) {
			code, msg = "canceled", "query canceled by client"
		}
		if werr := writeErr(conn, code, msg); werr != nil {
			return count, werr
		}
		return count, errStreamAborted
	}
	return count, nil
}

// readMsg reads one application-protocol message from conn. Transport-
// level frames (ping/pong) are silently consumed so the caller — most
// notably the cancel-reader goroutine in Query — does not exit on the
// first server-initiated keepalive pong. A close frame surfaces as an
// error so the caller can unwind cleanly; binary frames are rejected
// because the protocol is JSON-only.
func readMsg(conn *wsx.Conn) (queryStreamMsg, error) {
	for {
		op, data, err := conn.ReadMessage()
		if err != nil {
			return queryStreamMsg{}, err
		}
		switch op {
		case wsx.OpText:
			var m queryStreamMsg
			if err := json.Unmarshal(data, &m); err != nil {
				return queryStreamMsg{}, fmt.Errorf("ws: parse: %w", err)
			}
			return m, nil
		case wsx.OpPing, wsx.OpPong:
			// Transport-level keepalive; not part of the application protocol.
			continue
		case wsx.OpClose:
			return queryStreamMsg{}, errors.New("ws: peer closed connection")
		case wsx.OpBinary:
			return queryStreamMsg{}, errors.New("ws: unexpected binary frame")
		default:
			return queryStreamMsg{}, fmt.Errorf("ws: unexpected opcode 0x%x", op)
		}
	}
}

// writeMsg marshals m and writes a single text frame.
func writeMsg(conn *wsx.Conn, m queryStreamMsg) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return conn.WriteMessage(wsx.OpText, data)
}

// writeErr is a shorthand for emitting an {kind:"error", code, message}
// frame. Returns the write error (if any) so callers can short-circuit
// the handler with a single return.
func writeErr(conn *wsx.Conn, code, message string) error {
	return writeMsg(conn, queryStreamMsg{Kind: "error", Code: code, Message: message})
}

// stringsToAny converts the column-name slice from rows.Columns() into
// the []any payload shape the QueryStreamMsg.columns schema expects
// (open-typed array, future-proofing for richer column descriptors).
func stringsToAny(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// mapToNamedArgs converts the JSON-decoded params map into a slice of
// sql.Named values suitable for db.QueryContext. Mirrors the namedArgs
// helper used by the synchronous handler — the difference is that the
// WS frame already gives us a typed map, so no jsontext round-trip is
// needed. Empty/nil input returns (nil, nil).
//
// Returning an error today is reserved for future validation (e.g.
// rejecting reserved-name keys); the current implementation cannot
// fail.
func mapToNamedArgs(params map[string]any) ([]any, error) {
	if len(params) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(params))
	for k, v := range params {
		args = append(args, sql.Named(k, v))
	}
	return args, nil
}
