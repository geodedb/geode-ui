package server

import (
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// Public implements GET /api/v1/profiles/public — the bootstrap
// surface for the SPA's login page. It returns ONLY scope=system
// profiles' names + descriptions. DSNs, TLS material, pool overrides,
// and personal profiles are intentionally absent — this endpoint is
// unauthenticated, so leaking any of those would expose the upstream
// topology to anonymous callers.
//
// Authenticated callers should use GET /api/v1/profiles (Plan A)
// which returns the union of system + personal profiles with the
// owner/admin redaction matrix.
func (s *GraphServer) Public(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.PublicProfileList, error) {
	if s.cfg.Store == nil {
		// Legacy fallback: enumerate names from the pool.
		if s.cfg.Profiles == nil {
			return &gentypes.PublicProfileList{Profiles: []gentypes.PublicProfile{}}, nil
		}
		names := s.cfg.Profiles.Names()
		out := make([]gentypes.PublicProfile, 0, len(names))
		for _, n := range names {
			out = append(out, gentypes.PublicProfile{Name: n})
		}
		return &gentypes.PublicProfileList{Profiles: out}, nil
	}

	all, err := s.cfg.Store.List(r.Context(), profilestore.Filter{Scope: conn.ProfileScopeSystem})
	if err != nil {
		return nil, err
	}
	out := make([]gentypes.PublicProfile, 0, len(all))
	for _, p := range all {
		out = append(out, gentypes.PublicProfile{
			Name:        p.Name,
			Description: p.Description,
		})
	}
	return &gentypes.PublicProfileList{Profiles: out}, nil
}
