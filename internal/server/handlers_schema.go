package server

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Schema-discovery handlers — read-only catalog endpoints under
// /api/v1/graphs[/{graph}/...]. Each runs a fixed GQL statement against
// the connection-profile pool and reshapes the result into a typed list.
//
// GQL statements were verified against a local geode 0.x server during
// task B2:
//
//   SHOW GRAPHS                → [{name STRING}]
//   CALL db.labels()           → [{label STRING}]
//   CALL db.relationshipTypes() → [{relationshipType STRING}]
//   SHOW INDEXES               → [{name, type, table, columns}]
//   SHOW CONSTRAINTS           → [{name, type, table, columns}]
//
// Geode does not (yet) emit `label`/`property`/`kind` columns for
// indexes/constraints — the columns it does emit are surfaced as-is so
// the UI can render whatever the engine reports without a server-side
// remap that would silently drop new fields.

// Graphs implements GET /api/v1/graphs.
//
// The upstream Geode SHOW GRAPHS verb lists every graph in the engine,
// including the internal security graph (`__geode_security`) and any
// future double-underscore-prefixed system graphs. Those are
// implementation details of the security/audit layer — the dedicated
// admin endpoints (/api/v1/users, /api/v1/roles, /api/v1/audit) own
// the user-facing surface for that data. We strip them from the public
// /api/v1/graphs response so the SchemaExplorer's "first graph" auto-
// selection lands on a real user-data graph, not the system graph
// (the alphabetically-first slot would otherwise put `__geode_security`
// at index 0 and bury actual data behind a misleading default).
func (s *GraphServer) Graphs(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.GraphList, error) {
	names, err := s.queryStrings(r.Context(), "", "SHOW GRAPHS")
	if err != nil {
		return nil, schemaResponseErr(w, err)
	}
	return &gentypes.GraphList{Graphs: filterSystemGraphs(names)}, nil
}

// filterSystemGraphs drops any graph name that begins with the
// double-underscore "system" prefix Geode uses for internal graphs
// (e.g. `__geode_security`). Returns a fresh slice; the input slice is
// not mutated. Order is preserved.
func filterSystemGraphs(names []string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		if len(n) >= 2 && n[0] == '_' && n[1] == '_' {
			continue
		}
		out = append(out, n)
	}
	return out
}

// Labels implements GET /api/v1/graphs/{graph}/labels.
func (s *GraphServer) Labels(w http.ResponseWriter, r *http.Request, req *gentypes.GraphParam) (*gentypes.LabelList, error) {
	rows, err := s.queryStrings(r.Context(), req.Graph, "CALL db.labels()")
	if err != nil {
		return nil, schemaResponseErr(w, err)
	}
	return &gentypes.LabelList{Labels: rows}, nil
}

// EdgeTypes implements GET /api/v1/graphs/{graph}/edge-types.
func (s *GraphServer) EdgeTypes(w http.ResponseWriter, r *http.Request, req *gentypes.GraphParam) (*gentypes.EdgeTypeList, error) {
	rows, err := s.queryStrings(r.Context(), req.Graph, "CALL db.relationshipTypes()")
	if err != nil {
		return nil, schemaResponseErr(w, err)
	}
	return &gentypes.EdgeTypeList{Types: rows}, nil
}

// Indexes implements GET /api/v1/graphs/{graph}/indexes.
func (s *GraphServer) Indexes(w http.ResponseWriter, r *http.Request, req *gentypes.GraphParam) (*gentypes.IndexList, error) {
	items, err := s.queryRowMaps(r.Context(), req.Graph, "SHOW INDEXES")
	if err != nil {
		return nil, schemaResponseErr(w, err)
	}
	return &gentypes.IndexList{Indexes: items}, nil
}

// Constraints implements GET /api/v1/graphs/{graph}/constraints.
func (s *GraphServer) Constraints(w http.ResponseWriter, r *http.Request, req *gentypes.GraphParam) (*gentypes.ConstraintList, error) {
	items, err := s.queryRowMaps(r.Context(), req.Graph, "SHOW CONSTRAINTS")
	if err != nil {
		return nil, schemaResponseErr(w, err)
	}
	return &gentypes.ConstraintList{Constraints: items}, nil
}

// schemaResponseErr writes structured endpointError responses inline (so
// the generated wrapper does not turn them into a generic 500) and
// returns nil so the wrapper's "no error" branch executes without
// emitting a second body. Non-endpoint errors are returned untouched and
// surface as 500 — matching the synchronous Query handler's contract.
func schemaResponseErr(w http.ResponseWriter, err error) error {
	if ep := asEndpointError(err); ep != nil {
		writeEndpointError(w, ep)
		return nil
	}
	return err
}

// queryStrings runs stmt (optionally prefixed with a USE GRAPH clause) and
// returns the values from the first column as a []string. Non-string
// values are coerced via fmt.Sprint so the handler stays robust against
// driver-level type variation.
func (s *GraphServer) queryStrings(ctx context.Context, graph, stmt string) ([]string, error) {
	db, err := s.schemaDB(ctx)
	if err != nil {
		return nil, err
	}
	rows, _, err := runQuery(ctx, db, prefixUseGraph(graph, stmt))
	if err != nil {
		return nil, schemaErr(err)
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		if len(row) == 0 {
			continue
		}
		out = append(out, asString(row[0]))
	}
	return out, nil
}

// queryRowMaps runs stmt against graph and returns each row as a
// jsontext.Value object keyed by column name. Used for SHOW INDEXES /
// SHOW CONSTRAINTS where the schema models the row as an open object.
func (s *GraphServer) queryRowMaps(ctx context.Context, graph, stmt string) ([]jsontext.Value, error) {
	db, err := s.schemaDB(ctx)
	if err != nil {
		return nil, err
	}
	rows, cols, err := runQuery(ctx, db, prefixUseGraph(graph, stmt))
	if err != nil {
		return nil, schemaErr(err)
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := make(map[string]any, len(cols))
		for i, c := range cols {
			if i < len(row) {
				obj[c] = row[i]
			}
		}
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return out, nil
}

// schemaDB resolves the *sql.DB for the request's connection profile,
// surfacing pool failures as a 502 endpointError so the client gets a
// stable code rather than a generic 500.
func (s *GraphServer) schemaDB(ctx context.Context) (*sql.DB, error) {
	if s.cfg.Pool == nil {
		return nil, errors.New("server: pool not configured")
	}
	db, err := s.cfg.Pool.DB(profileFromContextOrDefault(ctx))
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadGateway,
			code:        "profile_unreachable",
			description: err.Error(),
		}
	}
	return db, nil
}

// prefixUseGraph returns stmt with a leading "USE GRAPH <sanitized>; "
// when graph is non-empty. Sanitisation is the same single-quote-free
// identifier filter used by the synchronous query handler.
func prefixUseGraph(graph, stmt string) string {
	if graph == "" {
		return stmt
	}
	return "USE GRAPH " + sanitizeGraphName(graph) + "; " + stmt
}

// schemaErr wraps a driver-level error from a catalog statement as a 422
// endpointError with code=schema_error so callers can distinguish it
// from authentication/transport failures.
func schemaErr(err error) error {
	if err == nil {
		return nil
	}
	return &endpointError{
		status:      http.StatusUnprocessableEntity,
		code:        "schema_error",
		description: err.Error(),
	}
}

// asString coerces a driver-returned value to a string. The geode driver
// scans STRING columns into string but other column types may surface as
// []byte or other primitives; fmt.Sprint handles all of them with no
// surprises for the catalog endpoints.
func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return fmt.Sprint(t)
	}
}
