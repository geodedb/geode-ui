package server

import (
	"encoding/json/v2"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Profiles implements GET /api/v1/profiles. It returns the set of named
// upstream Geode endpoints registered with the server.
//
// DSN strings are intentionally omitted — the connection-picker UI only
// needs profile names, and exposing DSNs would leak host/port/credential
// layout to any authenticated user. Description is reserved for a
// future per-profile human-readable label and is currently empty.
//
// The schema in geode.json declares each list item as an open object,
// which the generator emits as []jsontext.Value. Each entry is encoded
// with json/v2 so the wire shape matches the schema's items.
func (s *GraphServer) Profiles(_ http.ResponseWriter, _ *http.Request, _ *gentypes.Empty) (*gentypes.ProfileList, error) {
	if s.cfg.Profiles == nil {
		return &gentypes.ProfileList{Profiles: nil}, nil
	}
	names := s.cfg.Profiles.Names()
	out := make([]jsontext.Value, 0, len(names))
	for _, n := range names {
		raw, err := json.Marshal(map[string]string{"name": n})
		if err != nil {
			// Marshaling a map[string]string with a single ASCII key
			// can't fail with json/v2, but we still surface it as an
			// internal error rather than panicking.
			return nil, fmt.Errorf("profiles: marshal entry: %w", err)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.ProfileList{Profiles: out}, nil
}
