package server

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"geodedb.com/geode-ui/gen/pkg/securex"
)

// AuthCookieName is the name of the HttpOnly + SameSite=Strict cookie
// that carries the access JWT for SPA traffic (SEC-F7 / #62). It is a
// hard-coded constant so client and server agree without any runtime
// configuration. The cookie is the preferred transport for browser
// callers; the legacy Authorization header path is retained for
// programmatic callers (CLIs, MCP, tests) and the WS subprotocol /
// `?access_token=` fallback is retained for the WebSocket surface where
// browsers cannot attach cookies cross-origin without same-site context.
//
// Lookup order in AuthJWT:
//  1. Authorization: Bearer <jwt>      (preferred — programmatic, RFC 6750)
//  2. Cookie: geode-ui-auth=<jwt>      (preferred — SPA, XSS-resistant)
//  3. ?access_token=<jwt> querystring  (legacy — WS upgrade fallback)
//
// When more than one source is present the earlier wins so an attacker
// who pins a token in the URL or cookie cannot override a header set
// programmatically by the caller.
const AuthCookieName = "geode-ui-auth"

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
	tok, err := extractToken(r)
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
	ctx = context.WithValue(ctx, cidCtxKey, claims.ConnectionID)
	src := sourceForRequest(r)
	ctx = context.WithValue(ctx, authSourceCtxKey, src)
	// S-NEW-3 (genapi v0.3.2): stash a *securex.Claims on the context
	// so the generated per-route authz middleware reads pre-validated
	// claims directly via securex.ClaimsFromContext instead of
	// re-parsing the Authorization header. The geode jwt.Claims has
	// no scopes field — leave Scopes empty. Profile + ConnectionID are
	// forwarded into Attributes so a future required_attributes policy
	// can gate on them without a separate registry lookup.
	ctx = securex.ContextWithClaims(ctx, &securex.Claims{
		Subject: claims.Subject,
		Roles:   append([]string(nil), claims.Roles...),
		Attributes: map[string]string{
			"profile": claims.Profile,
			"cid":     claims.ConnectionID,
		},
	})
	*r = *r.WithContext(ctx)
	// PRE-v0.3.2: the genapi-emitted per-route middleware re-parsed
	// Authorization: Bearer to enforce required_roles, so AuthJWT had
	// to re-set the header for cookie/query-mode requests. POST-v0.3.2
	// the template prefers securex.ClaimsFromContext(r.Context()) and
	// only falls back to ParseClaims if the ctx is empty, so the
	// header shim is redundant. Removed (S-NEW-3 closed).
	return nil
}

// extractToken pulls the JWT off the request from one of three transports
// in priority order: Authorization header, geode-ui-auth cookie,
// ?access_token= query string. Returns an error if none carry a non-empty
// token. The Authorization header is parsed strictly (RFC 6750) — non-
// Bearer schemes or malformed shapes return an error rather than falling
// through, so a buggy client doesn't silently get authenticated by a
// stale cookie or pinned URL token.
func extractToken(r *http.Request) (string, error) {
	if h := r.Header.Get("Authorization"); h != "" {
		return extractBearer(r)
	}
	if c, err := r.Cookie(AuthCookieName); err == nil && c.Value != "" {
		return c.Value, nil
	}
	if q := r.URL.Query().Get("access_token"); q != "" {
		return q, nil
	}
	return "", errors.New("auth: missing Authorization header")
}

// extractBearer pulls the Bearer token off the Authorization header.
// As a fallback it accepts ?access_token= on the URL — browsers can't
// set Authorization headers on the WebSocket upgrade request, so the
// streaming surface needs a query-string path. Anything other than
// `Bearer <token>` is rejected.
//
// extractBearer is preserved as the strict-Authorization path for
// callers that already have an Authorization header. extractToken
// orchestrates the three-source lookup and dispatches here when the
// header is set.
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

// authSource enumerates the three transports AuthJWT accepts. Carried in
// the request context so the CSRF middleware (S3b) can decide whether
// to enforce a double-submit token: cookie-authenticated state-changing
// requests must also carry a matching CSRF header, while header-authed
// (programmatic) callers are exempt because browsers cannot forge an
// Authorization header cross-origin without explicit JS that already
// has same-origin DOM access.
type authSource int

const (
	authSourceNone authSource = iota
	authSourceHeader
	authSourceCookie
	authSourceQuery
)

// sourceForRequest reports which transport supplied the JWT. Mirrors
// the priority order in extractToken so the CSRF middleware sees the
// same source the parser used.
func sourceForRequest(r *http.Request) authSource {
	if r.Header.Get("Authorization") != "" {
		return authSourceHeader
	}
	if c, err := r.Cookie(AuthCookieName); err == nil && c.Value != "" {
		return authSourceCookie
	}
	if r.URL != nil && r.URL.Query().Get("access_token") != "" {
		return authSourceQuery
	}
	return authSourceNone
}

// authSourceFromContext returns the transport AuthJWT used to extract
// the JWT for this request, or authSourceNone if AuthJWT did not run.
// Used by the CSRF middleware to decide enforcement scope.
func authSourceFromContext(ctx context.Context) authSource {
	if v, ok := ctx.Value(authSourceCtxKey).(authSource); ok {
		return v
	}
	return authSourceNone
}
