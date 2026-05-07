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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"geodedb.com/geode-ui/gen/pkg/wsx"
	genws "geodedb.com/geode-ui/gen/ws"
)

// WSServer implements the generated genws.WSServerInterface. It carries
// the same Config as *GraphServer so it can reach the connection pool
// and any future cross-cutting dependencies (auth claims context keys,
// audit logger, etc.). It does NOT embed GraphServer — the WS surface
// has its own method-naming rules and we don't want to leak API
// methods into it accidentally.
type WSServer struct {
	genws.UnimplementedWSServer
	cfg Config
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

	// Spawn a reader goroutine that watches for cancel/close. Any
	// further message (or a read error / EOF) cancels the query
	// context. The main goroutine stays free to drive the rows
	// cursor and write frames.
	go func() {
		for {
			m, err := readMsg(conn)
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

	var count int64
	for rows.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return writeErr(conn, "scan", err.Error())
		}
		if err := writeMsg(conn, queryStreamMsg{Kind: "row", Row: row}); err != nil {
			return err
		}
		count++
	}
	if err := rows.Err(); err != nil {
		// Distinguish caller-initiated cancellation from a true
		// query failure so the client can surface a friendlier
		// message.
		if errors.Is(err, context.Canceled) {
			return writeErr(conn, "canceled", "query canceled by client")
		}
		return writeErr(conn, "query_error", err.Error())
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
