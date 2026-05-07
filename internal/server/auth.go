package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// AuthJWT is the genapi.APIOptions.AuthJWT (and genws.WSOptions.AuthJWT)
// callback wired up in cmd/server/main.go. It extracts the Bearer
// token from the request, verifies it against the configured Issuer,
// and attaches the resulting subject / profile / roles to the request
// context so downstream handlers (and required_roles enforcement in
// the generated wrapper) can read them.
//
// Returning a non-nil error makes the generated wrapper emit a 401.
// On success the request is mutated in place via *r = *r.WithContext(...)
// so the rest of the handler chain sees the enriched context. This
// mirrors the pattern in ~/src/devnw/go/oidc/server.go:113-124.
func (s *GraphServer) AuthJWT(r *http.Request) error {
	if s.cfg.JWT == nil {
		return errors.New("auth: jwt issuer not configured")
	}
	tok, err := extractBearer(r)
	if err != nil {
		return err
	}
	claims, err := s.cfg.JWT.Parse(tok)
	if err != nil {
		return err
	}
	ctx := r.Context()
	ctx = context.WithValue(ctx, userCtxKey, claims.Subject)
	ctx = context.WithValue(ctx, profileCtxKey, claims.Profile)
	ctx = context.WithValue(ctx, rolesCtxKey, claims.Roles)
	*r = *r.WithContext(ctx)
	return nil
}

// extractBearer pulls the Bearer token off the Authorization header.
// As a fallback it accepts ?access_token= on the URL — browsers can't
// set Authorization headers on the WebSocket upgrade request, so the
// streaming surface needs a query-string path. Anything other than
// `Bearer <token>` is rejected.
func extractBearer(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	if h == "" {
		if q := r.URL.Query().Get("access_token"); q != "" {
			return q, nil
		}
		return "", errors.New("auth: missing Authorization header")
	}
	parts := strings.Fields(h)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return "", errors.New("auth: malformed Authorization header")
	}
	if parts[1] == "" {
		return "", errors.New("auth: empty bearer token")
	}
	return parts[1], nil
}
