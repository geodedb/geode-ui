package server

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// queryColumn is the per-column descriptor we serialise as one element of
// QueryResp.columns. The genapi-emitted type is []jsontext.Value (an array
// of opaque JSON values), so we marshal each descriptor ourselves and
// install it as a jsontext.Value.
type queryColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Query implements ServerInterface.Query — POST /api/v1/query.
//
// Method name is generated as "Query" (not "PostApiV1Query") by genapi;
// see gen/api/handlers_gen.go.
func (s *GraphServer) Query(w http.ResponseWriter, r *http.Request, req *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	resp, err := s.handleQuery(r.Context(), req)
	if err != nil {
		if ep := asEndpointError(err); ep != nil {
			writeEndpointError(w, ep)
			return nil, nil
		}
		return nil, err
	}
	return resp, nil
}

func (s *GraphServer) handleQuery(ctx context.Context, req *gentypes.QueryReq) (*gentypes.QueryResp, error) {
	if s.cfg.Pool == nil {
		return nil, errors.New("server: pool not configured")
	}
	timeout := 30 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	stmt := req.Statement
	if req.Graph != "" {
		stmt = "USE GRAPH " + sanitizeGraphName(req.Graph) + "; " + stmt
	}

	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(ctx))
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadGateway,
			code:        "profile_unreachable",
			description: err.Error(),
		}
	}

	args, err := namedArgs(req.Params)
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_params",
			description: "params field is not a valid JSON object: " + err.Error(),
		}
	}

	start := time.Now()
	rows, err := db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        "query_error",
			description: err.Error(),
		}
	}
	defer func() { _ = rows.Close() }()

	cols, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("column types: %w", err)
	}
	colDescs := make([]jsontext.Value, len(cols))
	for i, name := range cols {
		raw, mErr := json.Marshal(queryColumn{Name: name, Type: colTypes[i].DatabaseTypeName()})
		if mErr != nil {
			return nil, fmt.Errorf("marshal column desc: %w", mErr)
		}
		colDescs[i] = jsontext.Value(raw)
	}

	var allRows [][]any
	var rowJSON []jsontext.Value
	for rows.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		allRows = append(allRows, row)
		raw, mErr := json.Marshal(row)
		if mErr != nil {
			return nil, fmt.Errorf("marshal row: %w", mErr)
		}
		rowJSON = append(rowJSON, jsontext.Value(raw))
	}
	if err := rows.Err(); err != nil {
		return nil, &endpointError{
			status:      http.StatusUnprocessableEntity,
			code:        "query_error",
			description: err.Error(),
		}
	}

	summary := extractGraphSummary(allRows)
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		return nil, fmt.Errorf("marshal graph summary: %w", err)
	}

	return &gentypes.QueryResp{
		Columns:      colDescs,
		Rows:         rowJSON,
		RowCount:     int64(len(allRows)),
		ElapsedMs:    time.Since(start).Milliseconds(),
		GraphSummary: jsontext.Value(summaryJSON),
	}, nil
}
