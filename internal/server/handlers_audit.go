package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"strconv"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// AuditDefaultLimit caps the entries returned per /api/v1/audit call
// when the caller does not specify `limit=`. Picked to be small enough
// that a 5-second poll cycle never moves a sizeable payload, but large
// enough that a fresh page load surfaces the recent operator activity
// the operator probably cared about. The ring itself is auditBufferCap
// = 10k; the cap below is the floor and AuditMaxLimit (10k) the ceiling.
const AuditDefaultLimit = 200

// AuditMaxLimit caps `?limit=` to the size of the ring. Callers that
// want the full ring set `?limit=10000` explicitly.
const AuditMaxLimit = 10_000

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
//
// PERF-2026-05-17-04 (#243): the ring used to ship its entire contents
// (up to 10k entries) on every poll because there was no server-side
// pagination. AuditLogPage poll cycles + per-keystroke refetch storms
// pushed ~2.5 MiB / poll through the JSON serialiser. The handler now
// honours an optional `?limit=N` query param (default 200, capped at
// auditBufferCap). Combined with the client-side 300 ms debounce in
// AuditLogPage.tsx this kills the refetch-burst payload by ~50x for
// the typical operator session.
func (s *GraphServer) Audit(_ http.ResponseWriter, r *http.Request, req *gentypes.AuditQuery) (*gentypes.AuditList, error) {
	since, err := parseAuditSince(req.Since)
	if err != nil {
		return nil, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidSince,
			description: err.Error(),
		}
	}
	limit := parseAuditLimit(r)
	entries := defaultAuditRing.snapshot(since)
	// snapshot() is chronologically ordered; iterate from the TAIL so
	// the most recent N entries surface first, which is what every
	// operator UI is asking for ("show me what just happened"). The
	// result slice is then reversed back into chronological order so
	// callers can keep using the same ordering contract.
	out := make([]jsontext.Value, 0, limit)
	for i := len(entries) - 1; i >= 0 && len(out) < limit; i-- {
		e := entries[i]
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
	// Restore chronological order so existing callers (the UI is
	// timeline-oriented) don't have to flip their rendering.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return &gentypes.AuditList{Entries: out}, nil
}

// parseAuditLimit reads the optional `?limit=N` query parameter and
// clamps it to [1, AuditMaxLimit]. An empty / invalid / non-positive
// value falls back to AuditDefaultLimit. The parser is intentionally
// permissive (non-numeric values silently use the default) because a
// caller-supplied limit is a UI hint, not a security boundary — the
// hard ceiling is what protects the wire from a 10k-entry blast.
func parseAuditLimit(r *http.Request) int {
	if r == nil || r.URL == nil {
		return AuditDefaultLimit
	}
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return AuditDefaultLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return AuditDefaultLimit
	}
	if n > AuditMaxLimit {
		return AuditMaxLimit
	}
	return n
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
