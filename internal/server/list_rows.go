package server

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"fmt"

	"encoding/json/jsontext"
)

// listRowsAsJSONValues runs a SHOW-style statement and returns each row
// as a json.RawMessage value already marshalled to the on-wire shape
// (a JSON object whose keys are the column names).
//
// It centralises the three-handler boilerplate that was previously
// duplicated by handlers_backups.go (GetBackups), handlers_policies.go
// (GetPolicies), and handlers_roles.go (GetRoles). Each handler used
// to:
//
//  1. Call runQuery(ctx, db, "<SHOW ...>")
//  2. Translate isWireFeatureMissing -> an empty []jsontext.Value
//     (so the SPA's gate sees a defined-but-empty list, not a 501)
//  3. Wrap any other driver error in wireErr(...)
//  4. Iterate rows, materialise rowToMap, json.Marshal, and append
//
// Steps (1)-(4) are now one helper; each handler becomes a 3-line
// wrapper around this call plus its specific normalisation callback.
//
// normaliseRow is an optional per-row hook applied to the map[string]any
// before marshalling. GetRoles uses it to copy the v0.5.15 `role_name`
// column to the legacy `name` key for back-compat. Pass nil when no
// per-row mutation is needed.
//
// noun is the human-readable singular noun used in error wrapping
// (e.g. "backup", "policy", "role") so the caller's failures are
// distinguishable in logs.
//
// Returns:
//
//   - []jsontext.Value (never nil; an empty slice when the upstream
//     wire feature is missing or no rows match) on success.
//   - error wrapping the driver-level failure on any other failure.
func listRowsAsJSONValues(
	ctx context.Context,
	db *sql.DB,
	stmt, noun string,
	normaliseRow func(map[string]any),
) ([]jsontext.Value, error) {
	rows, cols, err := runQuery(ctx, db, stmt)
	if err != nil {
		if isWireFeatureMissing(err) {
			return []jsontext.Value{}, nil
		}
		return nil, wireErr(err)
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := rowToMap(cols, row)
		if normaliseRow != nil {
			normaliseRow(obj)
		}
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal %s row: %w", noun, mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return out, nil
}
