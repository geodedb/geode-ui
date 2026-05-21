package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
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
// Phase 1 (this task): input validation only. The upstream-credentials
// probe and the profilestore.Put + JWT-mint pipeline ship in
// subsequent tasks so each diff stays reviewable.
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
	if err := validateOnboardRequest(&req); err != nil {
		writeEndpointError(w, err)
		return
	}
	// TODO(next task): probe upstream creds, create profile, mint JWT.
	writeEndpointError(w, &endpointError{
		status:      http.StatusNotImplemented,
		code:        ErrCodeNotImplemented,
		description: "upstream probe + storage path lands in task 2",
	})
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
