package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Audit implements GET /api/v1/audit — returns a chronological slice of
// the in-memory audit ring, optionally filtered by since/event/user.
//
// The ring is process-local (see audit.go) so this is a debugging /
// operator aid, not a durable audit destination. Operators that need
// long-term retention should ship the slog "AUDIT" lines to a SIEM and
// query them there.
//
// The response shape is `{ "entries": [ { ... } ] }` where each entry is
// a JSON object with `timestamp`, `event`, and `fields`. AuditList in
// the schema declares entries as `array<any>` so callers (the UI) can
// render arbitrary key/value pairs without a strict per-event schema —
// the `event` discriminator is the contract.
func (s *GraphServer) Audit(
	_ http.ResponseWriter, _ *http.Request, req *gentypes.AuditQuery,
) (*gentypes.AuditList, error) {
	since, err := parseAuditSince(req.Since)
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidSince,
			description: err.Error(),
		}
	}
	entries := defaultAuditRing.snapshot(since)
	out := make([]jsontext.Value, 0, len(entries))
	for _, e := range entries {
		if req.Event != "" && e.Event != req.Event {
			continue
		}
		if req.User != "" {
			if u, ok := e.Fields["user"].(string); !ok || u != req.User {
				continue
			}
		}
		raw, mErr := json.Marshal(e)
		if mErr != nil {
			return nil, fmt.Errorf("marshal audit entry: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.AuditList{Entries: out}, nil
}

// parseAuditSince parses the optional `since` query string. An empty
// value is treated as zero time (return everything). The parser accepts
// RFC3339 / RFC3339Nano timestamps so a UI that prefers either layout
// round-trips correctly.
func parseAuditSince(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("since must be RFC3339: %w", err)
	}
	return t, nil
}
