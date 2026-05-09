package server

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// PostProfiles implements POST /api/v1/profiles. (genapi-emitted name.)
//
// Authorisation:
//   - scope=system: requires admin role; OwnerUserID is forced to "".
//   - scope=personal: any authenticated user; OwnerUserID is forced to
//     actor.Subject so a user cannot create personal profiles for
//     someone else.
func (s *GraphServer) PostProfiles(w http.ResponseWriter, r *http.Request, req *gentypes.CreateProfileReq) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusServiceUnavailable,
			code:        "store_disabled",
			description: "profile store not configured",
		})
		return nil, nil
	}
	actr := actorFromContext(r.Context())
	isAdmin := hasRole(actr.Roles, "admin")
	scope := conn.ProfileScope(req.Scope)
	if !scope.Valid() {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_scope",
			description: "scope must be 'system' or 'personal'",
		})
		return nil, nil
	}

	owner := ""
	switch scope {
	case conn.ProfileScopeSystem:
		if !isAdmin {
			writeEndpointError(w, &endpointError{
				status:      http.StatusForbidden,
				code:        "forbidden",
				description: "system profiles require the admin role",
			})
			return nil, nil
		}
	case conn.ProfileScopePersonal:
		owner = actr.Subject
	}

	tlsMat, err := tlsFromGenJSON(req.TLS)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_tls",
			description: err.Error(),
		})
		return nil, nil
	}
	poolOv, err := poolOverridesFromGenJSON(req.PoolOverrides)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_pool_overrides",
			description: err.Error(),
		})
		return nil, nil
	}

	saved, err := s.cfg.Store.Put(r.Context(), conn.Profile{
		Scope:         scope,
		OwnerUserID:   owner,
		Name:          req.Name,
		DSN:           req.Dsn,
		Description:   req.Description,
		SavedUsername: req.SavedUsername,
		Default:       req.IsDefault,
		TLS:           tlsMat,
		PoolOverrides: poolOv,
	})
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	g := toGenProfile(saved, true)
	return &g, nil
}

// GetProfileid implements GET /api/v1/profiles/{profileId}.
func (s *GraphServer) GetProfileid(w http.ResponseWriter, r *http.Request, req *gentypes.ProfileIDPath) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{
			status: http.StatusServiceUnavailable,
			code:   "store_disabled",
		})
		return nil, nil
	}
	actr := actorFromContext(r.Context())
	isAdmin := hasRole(actr.Roles, "admin")
	p, err := s.cfg.Store.Get(r.Context(), req.ProfileID)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if p.Scope == conn.ProfileScopePersonal && p.OwnerUserID != actr.Subject && !isAdmin {
		writeEndpointError(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "not_found",
			description: "profile not found",
		})
		return nil, nil
	}
	reveal := isAdmin || p.OwnerUserID == actr.Subject
	g := toGenProfile(p, reveal)
	return &g, nil
}

// PatchProfileid implements PATCH /api/v1/profiles/{profileId}.
//
// IMPORTANT: genapi 0.x emits this method WITHOUT a path-struct
// parameter (only the request-body type is in the signature). The
// path id is read off r.PathValue("profileId"), which Go 1.22+
// http.ServeMux populates from the route pattern.
func (s *GraphServer) PatchProfileid(w http.ResponseWriter, r *http.Request, req *gentypes.UpdateProfileReq) (*gentypes.Profile, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{
			status: http.StatusServiceUnavailable,
			code:   "store_disabled",
		})
		return nil, nil
	}
	id := r.PathValue("profileId")
	if id == "" {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "missing_id",
			description: "path parameter profileId is required",
		})
		return nil, nil
	}
	actr := actorFromContext(r.Context())
	isAdmin := hasRole(actr.Roles, "admin")

	cur, err := s.cfg.Store.Get(r.Context(), id)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if !canMutate(cur, actr, isAdmin) {
		writeEndpointError(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "not_found",
			description: "profile not found",
		})
		return nil, nil
	}
	tlsMat, err := tlsFromGenJSON(req.TLS)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_tls",
			description: err.Error(),
		})
		return nil, nil
	}
	poolOv, err := poolOverridesFromGenJSON(req.PoolOverrides)
	if err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        "invalid_pool_overrides",
			description: err.Error(),
		})
		return nil, nil
	}
	patch := conn.Profile{
		Name:          req.Name,
		DSN:           req.Dsn,
		Description:   req.Description,
		SavedUsername: req.SavedUsername,
		Default:       req.IsDefault,
		TLS:           tlsMat,
		PoolOverrides: poolOv,
	}
	updated, err := s.cfg.Store.Patch(r.Context(), id, patch)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	g := toGenProfile(updated, true)
	return &g, nil
}

// DeleteProfileid implements DELETE /api/v1/profiles/{profileId}.
func (s *GraphServer) DeleteProfileid(w http.ResponseWriter, r *http.Request, req *gentypes.ProfileIDPath) (*gentypes.Empty, error) {
	if s.cfg.Store == nil {
		writeEndpointError(w, &endpointError{
			status: http.StatusServiceUnavailable,
			code:   "store_disabled",
		})
		return nil, nil
	}
	actr := actorFromContext(r.Context())
	isAdmin := hasRole(actr.Roles, "admin")
	cur, err := s.cfg.Store.Get(r.Context(), req.ProfileID)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	if !canMutate(cur, actr, isAdmin) {
		writeEndpointError(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "not_found",
			description: "profile not found",
		})
		return nil, nil
	}
	if err := s.cfg.Store.Delete(r.Context(), req.ProfileID); err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	s.maybeReload(r.Context())
	return &gentypes.Empty{}, nil
}

// canMutate is the authorisation predicate for PATCH and DELETE on a
// profile. Returns true if the actor may mutate the profile:
//   - scope=system → admin only
//   - scope=personal → owner OR admin
func canMutate(p conn.Profile, a actor, isAdmin bool) bool {
	switch p.Scope {
	case conn.ProfileScopeSystem:
		return isAdmin
	case conn.ProfileScopePersonal:
		return isAdmin || p.OwnerUserID == a.Subject
	}
	return false
}

// tlsFromGenJSON parses an incoming jsontext.Value as TLSMaterial wire
// shape. Empty value → empty TLSMaterial.
func tlsFromGenJSON(raw jsontext.Value) (conn.TLSMaterial, error) {
	if len(raw) == 0 {
		return conn.TLSMaterial{}, nil
	}
	var wire struct {
		CAPEM         string `json:"ca_pem"`
		ClientCertPEM string `json:"client_cert_pem"`
		ClientKeyPEM  string `json:"client_key_pem"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return conn.TLSMaterial{}, fmt.Errorf("tls: %w", err)
	}
	return conn.TLSMaterial{
		CAPEM:         wire.CAPEM,
		ClientCertPEM: wire.ClientCertPEM,
		ClientKeyPEM:  wire.ClientKeyPEM,
	}, nil
}

// poolOverridesFromGenJSON parses an incoming jsontext.Value as
// PoolOverrides wire shape. Empty value → empty PoolOverrides. Wire
// ms → time.Duration.
func poolOverridesFromGenJSON(raw jsontext.Value) (conn.PoolOverrides, error) {
	if len(raw) == 0 {
		return conn.PoolOverrides{}, nil
	}
	var wire struct {
		MaxOpenConns      int   `json:"max_open_conns"`
		MaxIdleConns      int   `json:"max_idle_conns"`
		ConnMaxLifetimeMs int64 `json:"conn_max_lifetime_ms"`
		ConnMaxIdleMs     int64 `json:"conn_max_idle_ms"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return conn.PoolOverrides{}, fmt.Errorf("pool_overrides: %w", err)
	}
	return conn.PoolOverrides{
		MaxOpenConns:    wire.MaxOpenConns,
		MaxIdleConns:    wire.MaxIdleConns,
		ConnMaxLifetime: time.Duration(wire.ConnMaxLifetimeMs) * time.Millisecond,
		ConnMaxIdleTime: time.Duration(wire.ConnMaxIdleMs) * time.Millisecond,
	}, nil
}

// maybeReload syncs the in-memory connection pool with the persisted
// profile set after a successful Store mutation. Errors are logged but
// not returned: the mutation has been persisted, and a failed reload
// only delays propagation until the next successful mutation or
// process restart.
func (s *GraphServer) maybeReload(ctx context.Context) {
	if s.cfg.PoolReloader == nil || s.cfg.Store == nil {
		return
	}
	all, err := s.cfg.Store.List(ctx, profilestore.Filter{})
	if err != nil {
		slog.Warn("profile reload: list failed", "err", err)
		return
	}
	if len(all) == 0 {
		return
	}
	if err := s.cfg.PoolReloader.Reload(all); err != nil {
		slog.Warn("profile reload: pool refused new set", "err", err)
	}
}
