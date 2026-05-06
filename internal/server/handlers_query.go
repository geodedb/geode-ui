package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

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

	resp, err := scanQueryResult(rows, start)
	if err != nil {
		// rows.Err() is the only error scanQueryResult passes through
		// without wrapping; surface it as a 422 for parity with the
		// pre-refactor behaviour. Wrapped scan/marshal errors fall
		// through to a 500 — same as before.
		if rerr := rows.Err(); rerr != nil && errors.Is(err, rerr) {
			return nil, &endpointError{
				status:      http.StatusUnprocessableEntity,
				code:        "query_error",
				description: err.Error(),
			}
		}
		return nil, err
	}
	return resp, nil
}
