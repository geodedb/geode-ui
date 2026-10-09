package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// defaultQueryTimeout bounds a query when the request does not set
// timeout_ms.
const defaultQueryTimeout = 30 * time.Second

// Query implements ServerInterface.Query — POST /api/v1/query.
//
// Method name is generated as "Query" (not "PostApiV1Query") by genapi;
// see gen/api/handlers_gen.go.
//
// PERF-F3 (#25): /api/v1/query is a *streaming* route (geode.json marks it
// "streaming": true), so the generated handler hands us the
// http.ResponseWriter and the contract becomes
// func(http.ResponseWriter, *http.Request, *QueryReq) error — this handler
// owns the entire 200 response body. We:
//
//  1. run every step that can fail *before any bytes are written* — pool
//     check, profile selection, params parsing, statement submission, and
//     column inspection — and on any such failure write the structured
//     {error,error_description} envelope ourselves (via writeEndpointError /
//     the wrapped-error → 500 fallthrough) and return nil so the generated
//     wrapper does not emit a second body. Returning a wrapped (non-endpoint)
//     error here is still safe: nothing is on the wire yet, so the wrapper's
//     500 envelope is correct.
//
//  2. once the column descriptors are in hand, write the response head
//     {"columns":[...],"rows":[ and Flush — at that point TTFB == time for
//     the driver to produce the first rows, *not* time to collect every row.
//
//  3. stream each row from the driver cursor as a JSON array element,
//     flushing every streamFlushEvery rows, then close the JSON document
//     with the row_count / elapsed_ms / graph_summary trailer.
//
// If the driver errors *after* the head is on the wire (a mid-stream
// rows.Scan or rows.Err failure), the response headers are already sent —
// we cannot retroactively turn the 200 into a 4xx. We return the error so
// the generated wrapper records the http_handler_err audit event; the JSON
// document is left intentionally truncated (unclosed) so the client sees
// the stream did not complete cleanly. (See the ServerInterface doc comment
// in gen/api/handlers_gen.go for the full streaming-handler error contract.)
//
// The wire shape is unchanged from the pre-streaming buffered handler: a
// JSON object with keys columns, rows, row_count, elapsed_ms, graph_summary.
// Generated/SPA clients consume it via res.json(), which is insensitive to
// key order, so the only observable change is that bytes start arriving
// sooner.
func (s *GraphServer) Query(w http.ResponseWriter, r *http.Request, req *gentypes.QueryReq) error {
	ctx := r.Context()
	if s.cfg.Pool == nil {
		return respondErr(w, errors.New("server: pool not configured"))
	}
	timeout := defaultQueryTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	rows, start, err := s.runQuery(ctx, req) //nolint:rowserrcheck // rows.Err() is checked inside streamQueryResult (result_codec.go).
	if err != nil {
		// Nothing has been written yet — surface the structured envelope
		// (for *endpointError) or a generic 500 (for anything else, via
		// the generated wrapper).
		return respondErr(w, err)
	}
	defer func() { _ = rows.Close() }()

	// Column inspection happens before the first byte, so a failure here
	// is still recoverable as a 500. scanQueryResult wraps these with
	// fmt.Errorf (no endpointError) which respondErr passes through.
	colDescs, cols, err := queryColumnDescs(rows)
	if err != nil {
		return respondErr(w, err)
	}

	rowCount, streamErr := streamQueryResult(w, rows, cols, colDescs, start)
	if streamErr != nil {
		// Head (and possibly some rows) already on the wire — the wrapper
		// will log http_handler_err; we cannot change the status.
		return streamErr
	}
	emitAudit(auditEventQueryExecuted,
		"user", userFromContext(ctx),
		"profile", profileFromContextOrDefault(ctx),
		"graph", req.Graph,
		"rows", rowCount,
		"elapsed_ms", time.Since(start).Milliseconds(),
	)
	return nil
}

// runQuery executes the (optionally graph-prefixed) GQL statement against
// the profile-selected DB and returns the open cursor plus the start time.
// Failures are classified as *endpointError where the buffered handler and
// the MCP tool both expect stable codes (profile_unreachable,
// invalid_params, query_error) so callers can write a consistent envelope.
//
// Shared by the streaming HTTP handler (Query) and the buffered codepath
// (handleQuery, used by the MCP `query` tool).
func (s *GraphServer) runQuery(ctx context.Context, req *gentypes.QueryReq) (*sql.Rows, time.Time, error) {
	stmt := req.Statement
	if req.Graph != "" {
		stmt = "USE GRAPH " + sanitizeGraphName(req.Graph) + "; " + stmt
	}

	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(ctx))
	if err != nil {
		return nil, time.Time{}, &endpointError{
			status:      http.StatusBadGateway,
			code:        ErrCodeProfileUnreachable,
			description: err.Error(),
		}
	}

	args, err := namedArgs(req.Params)
	if err != nil {
		return nil, time.Time{}, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidParams,
			description: "params field is not a valid JSON object: " + err.Error(),
		}
	}

	start := time.Now()
	rows, err := db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return nil, time.Time{}, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        ErrCodeQueryError,
			description: err.Error(),
		}
	}
	return rows, start, nil
}

// handleQuery is the buffered query path: it runs the statement, drains the
// whole cursor into a *gentypes.QueryResp, and returns it. Used by the MCP
// `query` tool (mcp.go), which has no streaming surface — the HTTP endpoint
// uses the streaming Query method above instead.
func (s *GraphServer) handleQuery(ctx context.Context, req *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	if s.cfg.Pool == nil {
		return nil, errors.New("server: pool not configured")
	}
	timeout := defaultQueryTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	rows, start, err := s.runQuery(ctx, req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	resp, err := scanQueryResult(rows, start)
	if err != nil {
		// rows.Err() is the only error scanQueryResult passes through
		// without wrapping; surface it as a 422 for parity with the
		// pre-refactor behaviour. Wrapped scan/marshal errors fall
		// through to a 500 — same as before.
		if rerr := rows.Err(); rerr != nil && errors.Is(err, rerr) {
			return nil, &endpointError{
				status:      http.StatusUnprocessableEntity,
				code:        ErrCodeQueryError,
				description: err.Error(),
			}
		}
		return nil, err
	}
	emitAudit(auditEventQueryExecuted,
		"user", userFromContext(ctx),
		"profile", profileFromContextOrDefault(ctx),
		"graph", req.Graph,
		"rows", resp.RowCount,
		"elapsed_ms", resp.ElapsedMs,
	)
	return resp, nil
}
