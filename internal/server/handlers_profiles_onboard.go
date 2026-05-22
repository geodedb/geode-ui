package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// OnboardRequest is the JSON body for POST /api/v1/profiles/onboard.
//
// Bug-feature (2026-05-21 login profile UX): unauthenticated profile
// creation. The endpoint accepts admin credentials for the supplied
// DSN and creates the profile ONLY after a successful auth probe.
// Used by the SPA's first-run + add-from-login flows; no existing
// JWT is required to call it.
type OnboardRequest struct {
	Name          string `json:"name"`
	DSN           string `json:"dsn"`
	Description   string `json:"description,omitempty"`
	AdminUsername string `json:"admin_username"`
	AdminPassword string `json:"admin_password"`
}

// OnboardResponse is the JSON body returned on a successful onboard.
// access_token / expires_in mirror /api/v1/auth/login so the SPA can
// roll straight into an authenticated session without a second
// round-trip.
type OnboardResponse struct {
	ProfileID    string `json:"profile_id"`
	ProfileName  string `json:"profile_name"`
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	ConnectionID string `json:"connection_id"`
}

// HandleOnboard implements POST /api/v1/profiles/onboard.
//
// Validates the supplied admin credentials against the supplied DSN by
// opening a one-shot *sql.DB and running RETURN 1, then persists a
// system-scope profile via the configured profilestore and mints a JWT
// so the SPA can roll straight into an authenticated session.
func (s *GraphServer) HandleOnboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req OnboardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeEndpointError(w, &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "request body must be valid JSON",
		})
		return
	}
	if vErr := validateOnboardRequest(&req); vErr != nil {
		// Audit pre-probe validation failures so a probe / spray pattern
		// that bottoms out on malformed payloads still leaves a trail.
		emitAudit(auditEventOnboardFailure,
			"user", req.AdminUsername,
			"name", req.Name,
			"target", onboardTargetForAudit(req.DSN),
			"reason", "validation",
		)
		writeEndpointError(w, vErr)
		return
	}

	// Probe the supplied DSN with the supplied credentials. The
	// onboarding path does not have a profile registered yet, so it
	// cannot route through the connection Pool the way Login does;
	// authenticateOnboard opens a one-shot *sql.DB keyed on the DSN.
	authenticate := s.cfg.testAuthenticateOnboard
	if authenticate == nil {
		authenticate = s.authenticateOnboard
	}
	roles, err := authenticate(r.Context(), req.DSN, req.AdminUsername, req.AdminPassword)
	if err != nil {
		emitAudit(auditEventOnboardFailure,
			"user", req.AdminUsername,
			"name", req.Name,
			"target", onboardTargetForAudit(req.DSN),
			"reason", "upstream_rejected",
		)
		writeEndpointError(w, &endpointError{
			status:      http.StatusUnauthorized,
			code:        ErrCodeUnauthorized,
			description: "upstream rejected the supplied admin credentials",
		})
		return
	}

	if s.cfg.Store == nil {
		emitAudit(auditEventOnboardFailure,
			"user", req.AdminUsername,
			"name", req.Name,
			"target", onboardTargetForAudit(req.DSN),
			"reason", "store_unavailable",
		)
		writeStoreUnavailable(w)
		return
	}

	p, err := s.cfg.Store.Put(r.Context(), conn.Profile{
		Scope:       conn.ProfileScopeSystem,
		Name:        req.Name,
		DSN:         req.DSN,
		Description: req.Description,
	})
	if err != nil {
		if errors.Is(err, profilestore.ErrConflict) {
			emitAudit(auditEventOnboardFailure,
				"user", req.AdminUsername,
				"name", req.Name,
				"target", onboardTargetForAudit(req.DSN),
				"reason", "duplicate_name",
			)
			writeEndpointError(w, &endpointError{
				status:      http.StatusConflict,
				code:        ErrCodeConflict,
				description: "a profile with that name already exists",
			})
			return
		}
		emitAudit(auditEventOnboardFailure,
			"user", req.AdminUsername,
			"name", req.Name,
			"target", onboardTargetForAudit(req.DSN),
			"reason", "store_error",
		)
		writeEndpointError(w, storeErrorToHTTP(err))
		return
	}

	// Grant the "admin" role to configured bootstrap admins — same
	// helper Login uses so first-time-onboarding admins land with the
	// same JWT shape as a subsequent /api/v1/auth/login round-trip.
	roles = s.adminRolesFor(req.AdminUsername, roles)

	if s.cfg.JWT == nil {
		// Successful create but no Issuer configured — return the
		// profile_id so a subsequent /api/v1/auth/login can take over.
		emitAudit(auditEventOnboardSuccess,
			"user", req.AdminUsername,
			"name", p.Name,
			"profile_id", p.ID,
			"target", onboardTargetForAudit(req.DSN),
			"token_minted", false,
		)
		writeJSON(w, http.StatusOK, OnboardResponse{
			ProfileID:   p.ID,
			ProfileName: p.Name,
			TokenType:   "bearer",
		})
		return
	}

	token, exp, err := s.cfg.JWT.Issue(req.AdminUsername, req.Name, roles, "")
	if err != nil {
		emitAudit(auditEventOnboardFailure,
			"user", req.AdminUsername,
			"name", p.Name,
			"profile_id", p.ID,
			"target", onboardTargetForAudit(req.DSN),
			"reason", "mint_failed",
		)
		writeEndpointError(w, &endpointError{
			status:      http.StatusInternalServerError,
			code:        ErrCodeInternalError,
			description: "could not mint access token",
		})
		return
	}
	expiresIn := s.mintAndSetAuthCookie(w, token, exp)
	emitAudit(auditEventOnboardSuccess,
		"user", req.AdminUsername,
		"name", p.Name,
		"profile_id", p.ID,
		"target", onboardTargetForAudit(req.DSN),
		"token_minted", true,
	)
	writeJSON(w, http.StatusOK, OnboardResponse{
		ProfileID:   p.ID,
		ProfileName: p.Name,
		AccessToken: token,
		TokenType:   "bearer",
		ExpiresIn:   expiresIn,
	})
}

// onboardTargetForAudit extracts the host:port piece of the supplied
// DSN for the audit-ring field. The full DSN sometimes carries
// inline credentials in the user-info section (operator misconfig);
// the audit pipeline's sensitive-keys list redacts any "dsn"-keyed
// field on principle, so we emit a credential-stripped target
// identifier instead. Falls back to the original DSN if url.Parse
// fails — better to log SOMETHING than to drop the audit row.
func onboardTargetForAudit(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || u.Host == "" {
		return dsn
	}
	return u.Scheme + "://" + u.Host
}

func validateOnboardRequest(req *OnboardRequest) *endpointError {
	req.Name = strings.TrimSpace(req.Name)
	req.DSN = strings.TrimSpace(req.DSN)
	req.AdminUsername = strings.TrimSpace(req.AdminUsername)
	if req.Name == "" || req.DSN == "" || req.AdminUsername == "" || req.AdminPassword == "" {
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "name, dsn, admin_username, and admin_password are required",
		}
	}
	// Defense in depth: the SPA's OnboardProfileForm caps the DSN
	// input at maxLength={1024}, but a programmatic caller is not
	// bound by that — and url.Parse + sql.Open will happily process
	// pathologically long DSNs that could feed an upstream parser DoS
	// or smuggle large payloads through a logging pipeline. Mirror
	// the SPA's bound on the server so the limit is the contract.
	if len(req.DSN) > 1024 {
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "dsn must be at most 1024 bytes",
		}
	}
	u, err := url.Parse(req.DSN)
	if err != nil || u.Scheme != "quic" || u.Host == "" {
		return &endpointError{
			status:      http.StatusBadRequest,
			code:        ErrCodeInvalidRequest,
			description: "dsn must be a quic:// URL with an explicit host:port",
		}
	}
	return nil
}

// authenticateOnboard mirrors authenticateUpstream but is keyed on an
// explicit DSN rather than a stored profile name. The onboarding path
// does not have a profile registered yet, so it cannot route through
// the connection Pool the way the login handler does. The roles slice
// is always nil for v0.5.x — Geode's wire dialect does not yet expose
// a queryable role-enumeration form, mirroring authenticateUpstream's
// best-effort behaviour. The caller layers the bootstrap-admin role
// via adminRolesFor.
//
// Returns a non-nil error on any failure (credential reject, transport
// error, parse error) — HandleOnboard collapses every failure into a
// single 401 so the caller cannot distinguish "wrong password" from
// "host unreachable", denying a side-channel for upstream probing.
func (s *GraphServer) authenticateOnboard(
	ctx context.Context, dsn, username, password string,
) ([]string, error) {
	probeDSN := injectCreds(dsn, username, password)
	db, err := sql.Open("geode", probeDSN)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()

	row := db.QueryRowContext(ctx, "RETURN 1")
	var v any
	if err := row.Scan(&v); err != nil {
		return nil, err
	}
	return nil, nil
}

// writeJSON serialises body as JSON to w with the given HTTP status and
// the standard application/json Content-Type. Used by HandleOnboard for
// its success path; the rest of the package uses writeEndpointError for
// error shapes and the generated handler chain for the standard 200
// path. Encoding errors are intentionally swallowed — by the time we
// reach the Encode call the status line is already flushed, so there's
// nothing actionable to do on a marshal failure.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
