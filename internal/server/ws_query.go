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
	"sync/atomic"
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

// wsPtrsPool reuses []any slabs of pointers-to-row-cells used by
// rows.Scan. PERF #251: streamRowsOverWS allocates a fresh `ptrs`
// slab per scanned row. The slab is only live across the single Scan
// call — after Scan returns, the values are in the (separately
// allocated, still-retained-by-the-batcher) `row` slab and ptrs is
// garbage. Pooling drops one make([]any, len(cols)) per row.
//
// Lifetime guarantee: ptrs is acquired, populated with &row[i], passed
// to rows.Scan(ptrs...), and Put back BEFORE the row is handed to
// batcher.add. The batcher's "rows are referenced until the next
// flush" contract applies to the row slab, NOT to ptrs — once Scan
// returns the pointers serve no further purpose.
var wsPtrsPool = sync.Pool{
	New: func() any { return &[]any{} },
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
		return writeErr(conn, ErrCodeWSInternal, "pool not configured")
	}
	ctx, cancel := context.WithCancel(conn.Context())
	defer cancel()

	first, err := readMsg(conn)
	if err != nil {
		return err
	}
	if first.Kind != "start" || first.Statement == "" {
		return writeErr(conn, ErrCodeWSBadRequest, "first message must be kind=start with non-empty statement")
	}

	profileName := profileFromContextOrDefault(ctx)
	db, err := s.cfg.Pool.DB(profileName)
	if err != nil {
		return writeErr(conn, ErrCodeProfileUnreachable, err.Error())
	}

	stmt := first.Statement
	if first.Graph != "" {
		stmt = "USE GRAPH " + sanitizeGraphName(first.Graph) + "; " + stmt
	}

	// Spawn the single cancel-reader goroutine (PERF #218): it watches
	// for {kind:"cancel"}, a read error, EOF, or a close frame and
	// cancels the query context so db.QueryContext aborts promptly.
	// On graceful return Query MUST call cr.Shutdown(conn) so the
	// parked ReadMessage wakes up; otherwise the reader would sit on
	// the 30s read deadline before noticing shutdown.
	cr := s.startCancelReader(conn, cancel)
	defer cr.Shutdown(conn)

	args, err := mapToNamedArgs(first.Params)
	if err != nil {
		return writeErr(conn, ErrCodeInvalidParams, err.Error())
	}

	start := time.Now()
	rows, err := db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return writeErr(conn, ErrCodeQueryError, err.Error())
	}
	defer func() { _ = rows.Close() }()

	cols, err := rows.Columns()
	if err != nil {
		return writeErr(conn, ErrCodeWSInternal, err.Error())
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

// errStreamAborted is the sentinel streamRowsOverWS returns after it has
// already emitted a terminal frame ("scan" / "canceled" / "query_error")
// to the client. Query treats any non-nil return from streamRowsOverWS as
// "stop, do not write summary/end"; this sentinel lets the caller tell a
// successful-error-frame write apart from a real frame-write failure
// without leaking it onto the wire.
var errStreamAborted = errors.New("ws: stream aborted (terminal frame already sent)")

// cancelReader holds the per-session state for the single
// cancel-reader goroutine (PERF #218). The prior implementation used
// two goroutines per /ws/query session (coordinator + relay) which
// allocated a channel and a struct per session. This struct is owned
// by Query and lives on its stack: zero heap allocations per session
// beyond the single goroutine itself.
type cancelReader struct {
	// shutdown flips from 0 -> 1 exactly once when Shutdown() is called
	// by the handler's defer chain. The reader goroutine consults it on
	// every readMsg return to discriminate caller-initiated shutdown
	// (poison-deadline wakeup) from genuine peer error.
	shutdown atomic.Bool
	exited   chan struct{}
}

// startCancelReader spawns ONE goroutine that watches the inbound side
// of a /ws/query connection and cancels the query context on the first
// {kind:"cancel"} message, read error, EOF, or close frame.
//
// PERF #218: the prior version spawned two goroutines per /ws/query
// session (a coordinator that selected on <-done and a bounded relay
// that blocked in readMsg), so 1000 concurrent sessions cost 2000
// goroutines plus per-session channel allocations. We collapse both
// into ONE goroutine using the per-read deadline that
// wsx.Conn.ReadMessage already applies on each call (see
// gen/pkg/wsx/ws.go). When the handler defers Shutdown(), the read
// deadline on the underlying net.Conn is pushed into the past, the
// parked ReadMessage returns immediately with a deadline-exceeded
// error, and the reader sees shutdown=true and exits without calling
// cancel() (cancel() is already deferred by Query on the happy path).
func (s *WSServer) startCancelReader(conn *wsx.Conn, cancel context.CancelFunc) *cancelReader {
	cr := &cancelReader{exited: make(chan struct{})}
	go func() {
		defer close(cr.exited)
		if s.onCancelReaderExit != nil {
			defer s.onCancelReaderExit()
		}
		for {
			m, err := readMsg(conn)
			// Check shutdown FIRST so a deadline-poison wakeup driven
			// by cr.Shutdown(conn) is recognised as graceful shutdown
			// rather than a spurious error/cancel.
			if cr.shutdown.Load() {
				return
			}
			if err != nil {
				cancel()
				return
			}
			if m.Kind == "cancel" {
				cancel()
				return
			}
		}
	}()
	return cr
}

// Shutdown signals the cancel-reader goroutine to exit promptly. It is
// safe to call multiple times. The implementation flips shutdown=true
// then pushes the read deadline on conn's underlying net.Conn into the
// past so the parked ReadMessage returns immediately. Safe to call on
// nil conn or on a conn whose NetConn is nil (test pipes).
func (cr *cancelReader) Shutdown(conn *wsx.Conn) {
	cr.shutdown.Store(true)
	if conn == nil {
		return
	}
	nc := conn.NetConn()
	if nc == nil {
		return
	}
	// time.Unix(1, 0) is strictly in the past; using a non-zero value
	// avoids the "zero time = no deadline" interpretation some net.Conn
	// implementations apply, while still firing the deadline immediately.
	_ = nc.SetReadDeadline(time.Unix(1, 0))
}

// Exited returns a channel that closes when the cancel-reader
// goroutine has fully returned. Production ignores it; tests assert
// on it.
func (cr *cancelReader) Exited() <-chan struct{} { return cr.exited }

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
		// row carries the scanned values and is retained by the
		// batcher (see (*rowBatcher).add comment); allocate fresh.
		row := make([]any, len(cols))
		// PERF #251: ptrs is a transient slab — only live across
		// rows.Scan. Acquire from the pool, ensure capacity, slice
		// to len(cols), populate &row[i], and Put back as soon as
		// Scan returns. The Put happens BEFORE batcher.add so the
		// pool reference cannot outlive the batcher's row reference.
		ptrsP := wsPtrsPool.Get().(*[]any)
		ptrs := *ptrsP
		if cap(ptrs) < len(cols) {
			ptrs = make([]any, len(cols))
		} else {
			ptrs = ptrs[:len(cols)]
		}
		for i := range row {
			ptrs[i] = &row[i]
		}
		err := rows.Scan(ptrs...)
		// Clear pointers before Put so we don't pin the row slab via
		// the pooled slab — the GC needs row[i] to be reachable only
		// through the batcher's b.buf.
		for i := range ptrs {
			ptrs[i] = nil
		}
		*ptrsP = ptrs[:0]
		wsPtrsPool.Put(ptrsP)
		if err != nil {
			// Drain any pending batch so partial progress reaches
			// the client before the error frame.
			_ = batcher.flush()
			if werr := writeErr(conn, ErrCodeWSScan, err.Error()); werr != nil {
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
		code, msg := ErrCodeQueryError, err.Error()
		if errors.Is(err, context.Canceled) {
			code, msg = ErrCodeWSCanceled, "query canceled by client"
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
