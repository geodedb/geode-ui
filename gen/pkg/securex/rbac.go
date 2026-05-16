package securex

import (
	"context"
	"encoding/base64"
	"encoding/json/v2"
	"net/http"
	"slices"
	"strings"
)

// claimsKey is the unexported context key under which securex stashes
// the verifier-validated Claims pointer. Owned by this package so
// consumers go through ContextWithClaims / ClaimsFromContext rather
// than guessing the key. Mirrors the ctxRolesKey pattern in
// pkg/mcpx/engine.go for the role-context stash.
type claimsKey struct{}

// ContextWithClaims returns a copy of ctx carrying the supplied Claims
// pointer. The generated per-route middleware first checks
// ClaimsFromContext(r.Context()) before re-parsing the bearer token,
// so a verifier (e.g. APIOptions.AuthJWT) that calls this once per
// request avoids the second base64-decode-and-Unmarshal per route.
// (S-NEW-3.)
//
// Passing a nil claims pointer stores a typed-nil so subsequent
// ClaimsFromContext(ctx) returns (nil, false) — this mirrors the
// "auth ran, but no claims attached" sentinel used by mcpx's
// ContextWithRoles when called with a nil slice.
//
// Passing a nil ctx is safe and returns a context.Background()-derived
// value so downstream code can always derive a new ctx from the result.
func ContextWithClaims(ctx context.Context, claims *Claims) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, claimsKey{}, claims)
}

// ClaimsFromContext returns the Claims pointer stashed by
// ContextWithClaims, or (nil, false) if no claims have been attached.
// The returned pointer is the same value passed to ContextWithClaims
// (not a copy); callers MUST treat it as read-only or risk torn reads
// across goroutines that share the request context.
// (S-NEW-3.)
func ClaimsFromContext(ctx context.Context) (*Claims, bool) {
	if ctx == nil {
		return nil, false
	}
	v, _ := ctx.Value(claimsKey{}).(*Claims)
	if v == nil {
		return nil, false
	}
	return v, true
}

// Role represents an RBAC privilege level. Higher values mean greater privilege.
type Role int

const (
	RoleUser    Role = iota // lowest privilege (default)
	RoleManager             // intermediate privilege
	RoleAdmin               // highest privilege
)

// RoleFromString parses a case-insensitive role name into a Role value.
// Returns ErrInvalidConfig for unknown role names.
func RoleFromString(s string) (Role, error) {
	switch strings.ToLower(s) {
	case "admin":
		return RoleAdmin, nil
	case "manager":
		return RoleManager, nil
	case "user":
		return RoleUser, nil
	default:
		return RoleUser, ErrInvalidConfig
	}
}

// String returns the canonical name of a role.
func (r Role) String() string {
	switch r {
	case RoleAdmin:
		return "admin"
	case RoleManager:
		return "manager"
	default:
		return "user"
	}
}

// HasRole returns true if r has at least the privilege level of required.
// Implements the role hierarchy: admin ≥ manager ≥ user.
func (r Role) HasRole(required Role) bool {
	return r >= required
}

// Claims holds the JWT payload fields relevant to RBAC and scope enforcement.
// Call ParseClaims only after the token signature has been verified.
type Claims struct {
	Subject    string            `json:"sub"`
	Roles      []string          `json:"roles"`
	Scopes     []string          `json:"scopes"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

// ParseClaims decodes the payload of a compact JWS token and returns the Claims.
// It does NOT verify the token signature; callers must call VerifyJWT first.
func ParseClaims(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrJWTUnsupported
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrJWTUnsupported
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, ErrJWTUnsupported
	}
	return &c, nil
}

// HighestRole returns the highest Role found in the claims' Roles list.
// Returns RoleUser if the list is empty or contains no recognised role names.
func (c *Claims) HighestRole() Role {
	best := RoleUser
	for _, r := range c.Roles {
		if parsed, err := RoleFromString(r); err == nil && parsed > best {
			best = parsed
		}
	}
	return best
}

// HasScope returns true if the claims list contains the exact scope string.
func (c *Claims) HasScope(scope string) bool {
	return slices.Contains(c.Scopes, scope)
}

// tokenFromRequest extracts the JWT token from the Authorization header.
func tokenFromRequest(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.Fields(auth)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

// RequireRole returns an http.Handler middleware that enforces a minimum role.
// The JWT is read from "Authorization: Bearer <token>" and verified with secret.
// Requests whose highest role is below minimum receive 403 Forbidden.
// Requests with missing/invalid tokens receive 401 Unauthorized.
func RequireRole(minimum Role, secret []byte, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := tokenFromRequest(r)
		if tok == "" {
			http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
			return
		}
		if err := VerifyJWT(tok, secret); err != nil {
			http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
			return
		}
		claims, err := ParseClaims(tok)
		if err != nil {
			http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
			return
		}
		if !claims.HighestRole().HasRole(minimum) {
			http.Error(w, ErrInsufficientRole.Error(), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ABACPolicy defines an attribute evaluation policy.
type ABACPolicy interface {
	// Evaluate returns true if the claims satisfy the policy.
	Evaluate(c *Claims) bool
}

// ABACPolicyFunc is a function type that implements ABACPolicy.
type ABACPolicyFunc func(c *Claims) bool

// Evaluate calls the underlying function.
func (f ABACPolicyFunc) Evaluate(c *Claims) bool {
	return f(c)
}

// MatchAttribute returns a policy that evaluates to true if the attribute exactly matches the given value.
func MatchAttribute(key, value string) ABACPolicy {
	return ABACPolicyFunc(func(c *Claims) bool {
		if c.Attributes == nil {
			return false
		}
		v, ok := c.Attributes[key]
		return ok && v == value
	})
}

// HasAttribute returns a policy that evaluates to true if the attribute key exists.
func HasAttribute(key string) ABACPolicy {
	return ABACPolicyFunc(func(c *Claims) bool {
		if c.Attributes == nil {
			return false
		}
		_, ok := c.Attributes[key]
		return ok
	})
}

// RequireABAC returns an http.Handler middleware that enforces ABAC policies.
// The JWT is verified using the secret, and all policies must evaluate to true.
// Fails with 401 Unauthorized for invalid tokens, and 403 Forbidden for policy failures.
func RequireABAC(secret []byte, policies ...ABACPolicy) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := tokenFromRequest(r)
			if tok == "" {
				http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
				return
			}
			if err := VerifyJWT(tok, secret); err != nil {
				http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
				return
			}
			claims, err := ParseClaims(tok)
			if err != nil {
				http.Error(w, ErrAuthFailed.Error(), http.StatusUnauthorized)
				return
			}
			for _, policy := range policies {
				if !policy.Evaluate(claims) {
					http.Error(w, ErrInsufficientRole.Error(), http.StatusForbidden)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
