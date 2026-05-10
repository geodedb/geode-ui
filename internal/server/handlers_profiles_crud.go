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
	emitAudit(auditEventProfileCreated,
		"actor", actr.Subject,
		"profile_id", saved.ID,
		"scope", string(saved.Scope),
		"owner", saved.OwnerUserID,
		"name", saved.Name,
	)
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
	patch, perr := buildProfilePatch(req)
	if perr != nil {
		writeEndpointError(w, perr)
		return nil, nil
	}
	updated, err := s.cfg.Store.Patch(r.Context(), id, patch)
	if err != nil {
		writeEndpointError(w, storeErrorToHTTP(err))
		return nil, nil
	}
	emitAudit(auditEventProfileUpdated,
		"actor", actr.Subject,
		"profile_id", updated.ID,
		"scope", string(updated.Scope),
		"owner", updated.OwnerUserID,
		"name", updated.Name,
	)
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
	emitAudit(auditEventProfileDeleted,
		"actor", actr.Subject,
		"profile_id", cur.ID,
		"scope", string(cur.Scope),
		"owner", cur.OwnerUserID,
		"name", cur.Name,
	)
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
//
// Used by PostProfiles where the schema requires the field be present
// (the wire is always materialised on creation). PatchProfileid uses
// tlsPatchFromGenJSON, which preserves the absent / present-empty
// distinction required by PSR-G02.
//
// GAP-S10 (#123): each non-empty PEM field is validated via validatePEM
// (pemvalidate.go) before being returned. Empty strings continue to
// flow through unchanged so the "clear all TLS material" PATCH path
// (PSR-G02) keeps working. Caps each field at 64 KiB.
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
	if err := validateTLSMaterialPEM(wire.CAPEM, wire.ClientCertPEM, wire.ClientKeyPEM); err != nil {
		return conn.TLSMaterial{}, err
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

// tlsPatchFromGenJSON returns a *TLSMaterial when the incoming raw
// jsontext.Value is non-empty (caller intends to set OR clear) and nil
// when the wire key was absent (caller wants to leave the persisted
// value alone). This is the half of PSR-G02 that the genapi-emitted
// jsontext.Value field type already supports natively at the wire
// layer; the SPA's tlsToWire helper sends `tls: {}` on the clear path
// so the raw value here is the two-byte literal "{}", which decodes
// to a non-nil pointer to an all-empty TLSMaterial -- exactly the
// "clear all" signal mergeProfile is looking for.
func tlsPatchFromGenJSON(raw jsontext.Value) (*conn.TLSMaterial, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	mat, err := tlsFromGenJSON(raw)
	if err != nil {
		return nil, err
	}
	return &mat, nil
}

// poolPatchFromGenJSON mirrors tlsPatchFromGenJSON for the
// pool_overrides field.
func poolPatchFromGenJSON(raw jsontext.Value) (*conn.PoolOverrides, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	po, err := poolOverridesFromGenJSON(raw)
	if err != nil {
		return nil, err
	}
	return &po, nil
}

// buildProfilePatch translates the genapi-emitted UpdateProfileReq
// (where nullable scalar fields arrive as Go pointers — *string, *bool —
// thanks to genapi's nullable scalar support, see PSR-G02-followup) into
// a profilestore.ProfilePatch with pointer-typed optionals.
//
// Pointer presence semantics flow straight through:
//   - nil pointer  -> field absent on the wire    -> preserve current value
//   - non-nil ptr  -> field present (incl. zero)  -> set / clear to the value
//
// For tls and pool_overrides the wire stays a jsontext.Value (object types
// are not subject to the nullable-scalar treatment) and the existing
// tlsPatchFromGenJSON / poolPatchFromGenJSON helpers preserve the
// absent / clear / set distinction at the JSON layer.
func buildProfilePatch(req *gentypes.UpdateProfileReq) (profilestore.ProfilePatch, *endpointError) {
	patch := profilestore.ProfilePatch{
		Name:          req.Name,
		DSN:           req.Dsn,
		Description:   req.Description,
		SavedUsername: req.SavedUsername,
		Default:       req.IsDefault,
	}

	tlsP, err := tlsPatchFromGenJSON(req.TLS)
	if err != nil {
		return profilestore.ProfilePatch{}, &endpointError{
			status: http.StatusBadRequest, code: "invalid_tls", description: err.Error(),
		}
	}
	patch.TLS = tlsP

	poP, err := poolPatchFromGenJSON(req.PoolOverrides)
	if err != nil {
		return profilestore.ProfilePatch{}, &endpointError{
			status: http.StatusBadRequest, code: "invalid_pool_overrides", description: err.Error(),
		}
	}
	patch.PoolOverrides = poP
	return patch, nil
}

// reloadSingleFlightKey is the constant key passed to
// singleflight.Group.Do in reloadAsync. All triggers coalesce on this
// single key; the Group's internal map ensures only one List+Reload is
// in flight at a time across the whole process.
const reloadSingleFlightKey = "profile-reload"

// maybeReload schedules an asynchronous sync of the in-memory
// connection pool with the persisted profile set. It is a fire-and-
// forget trigger: the caller (a CRUD handler) is freed from the
// request critical path immediately and the actual List + Reload runs
// in a background goroutine.
//
// Coalescing (PSR-F1 / #94):
//   - reloadVersion is bumped on every call. Concurrent triggers all
//     observe a strictly increasing version.
//   - The background worker uses singleflight.Group to ensure at most
//     one List+Reload pair is in flight at a time across the whole
//     server. A burst of N rapid CRUD writes collapses to 1 (or 2)
//     underlying Reload calls instead of N.
//
// Errors are logged via slog and emitted to the audit ring (the
// auditEventProfileReloadFail event preserved from PSR-G08); the
// HTTP response has already been written by the time these surface,
// so they cannot be returned to the caller. A failed reload only
// delays propagation until the next successful mutation or process
// restart.
//
// The captured actor for audit purposes is read from ctx BEFORE
// spawning the goroutine; the request context itself is not used in
// the background worker because the worker outlives the HTTP request.
func (s *GraphServer) maybeReload(ctx context.Context) {
	if s.cfg.PoolReloader == nil || s.cfg.Store == nil {
		return
	}
	actorSubject := actorFromContext(ctx).Subject
	triggeredAt := s.reloadVersion.Add(1)
	s.reloadInflight.Add(1)
	go func() {
		defer s.reloadInflight.Done()
		s.reloadAsync(actorSubject, triggeredAt)
	}()
}

// reloadAsync is the singleflight-coalesced background worker that
// drives one List+Reload pair. Multiple concurrent invocations with
// the same key share the same in-flight result; the first goroutine
// runs the work, the rest wait and return immediately.
//
// We use Forget() unconditionally after Do returns so the next trigger
// (which may have observed a newer reloadVersion) is not deduplicated
// against the just-completed run. Without Forget, a write that landed
// while the prior reload was mid-flight could share the same cached
// result and never actually be applied to the pool.
func (s *GraphServer) reloadAsync(actorSubject string, _ int64) {
	_, _, _ = s.reloadGroup.Do(reloadSingleFlightKey, func() (any, error) {
		// Fresh background context; the originating HTTP request may
		// have been cancelled by the time we run.
		ctx := context.Background()
		all, err := s.cfg.Store.List(ctx, profilestore.Filter{})
		if err != nil {
			slog.Warn("profile reload: list failed", "err", err)
			emitAudit(auditEventProfileReloadFail,
				"actor", actorSubject,
				"phase", "list",
				"error", err.Error(),
			)
			return nil, err
		}
		if len(all) == 0 {
			return nil, nil
		}
		if err := s.cfg.PoolReloader.Reload(all); err != nil {
			slog.Warn("profile reload: pool refused new set", "err", err)
			emitAudit(auditEventProfileReloadFail,
				"actor", actorSubject,
				"phase", "reload",
				"error", err.Error(),
			)
			return nil, err
		}
		return nil, nil
	})
	s.reloadGroup.Forget(reloadSingleFlightKey)
}
