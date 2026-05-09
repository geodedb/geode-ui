package server

import (
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Profiles implements GET /api/v1/profiles. It returns the set of named
// upstream Geode endpoints registered with the server.
//
// DSN strings are intentionally omitted — the connection-picker UI only
// needs profile names, and exposing DSNs would leak host/port/credential
// layout to any authenticated user. Description is reserved for a
// future per-profile human-readable label and is currently empty.
func (s *GraphServer) Profiles(_ http.ResponseWriter, _ *http.Request, _ *gentypes.Empty) (*gentypes.ProfileList, error) {
	if s.cfg.Profiles == nil {
		return &gentypes.ProfileList{Profiles: nil}, nil
	}
	names := s.cfg.Profiles.Names()
	out := make([]gentypes.Profile, 0, len(names))
	for _, n := range names {
		out = append(out, gentypes.Profile{Name: n})
	}
	return &gentypes.ProfileList{Profiles: out}, nil
}
