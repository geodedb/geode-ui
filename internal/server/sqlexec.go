package server

import (
	"context"
	"database/sql"

	"encoding/json/jsontext"
	"encoding/json/v2"
)

// runQuery executes stmt against db and
// materialises the full result set into ([][]any, []string, nil) where the
// first return is the rows (one []any per row, one element per column) and
// the second is the column names in driver order.
//
// It is intended for short, fixed-shape catalog statements (SHOW GRAPHS,
// CALL db.labels(), SHOW INDEXES, …) — multiple B-series handlers use it.
// Long-running streaming queries should iterate rows directly to avoid
// buffering the whole result set in memory.
func runQuery(ctx context.Context, db *sql.DB, stmt string) ([][]any, []string, error) {
	rows, err := db.QueryContext(ctx, stmt)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()

	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}

	var out [][]any
	for rows.Next() {
		row := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range row {
			ptrs[i] = &row[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return out, cols, nil
}

// runStatement executes stmt against db and
// returns the driver's sql.Result. It is the DDL/DML counterpart to
// runQuery — administrative commands like CREATE USER, DROP USER, ALTER
// USER, GRANT, and REVOKE typically have no result set, so the user-
// management handlers funnel them through here. Errors are returned
// untouched so the caller can wrap them with handler-specific endpoint
// codes.
func runStatement(ctx context.Context, db *sql.DB, stmt string) (sql.Result, error) {
	return db.ExecContext(ctx, stmt)
}

// namedArgs converts a JSON-encoded params object into a slice of
// sql.NamedArg suitable for db.QueryContext. Empty/null/missing input
// returns (nil, nil); a syntactically invalid JSON value returns the
// underlying decode error so the handler can surface a 400 rather than
// silently dropping the parameters. Each property becomes one sql.Named
// entry.
//
// Values are passed through as decoded Go primitives (string/float64/bool/
// nil/[]any/map[string]any) — driver-side parameter coercion is the geode
// driver's responsibility.
func namedArgs(raw jsontext.Value) ([]any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(m))
	for k, v := range m {
		args = append(args, sql.Named(k, v))
	}
	return args, nil
}
