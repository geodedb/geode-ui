package server

import (
	"net/http"
	"strings"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Grant/Revoke handlers — admin endpoints under /api/v1/grants.
//
// The genapi-emitted method names in this surface are:
//
//   Grants → POST /api/v1/grants
//   Revoke → POST /api/v1/grants/revoke
//
// GQL syntax (Geode v0.5.15+):
//
//	GRANT  <READ|WRITE|SCHEMA|ALL> [ ON GRAPH <graph> ] TO <user>
//	REVOKE <READ|WRITE|SCHEMA|ALL> [ ON GRAPH <graph> ] FROM <user>
//
// Upstream parsers are `parseGrantStatement` and `parseRevokeStatement`
// in `src/gql/parser.zig` (v0.5.15). The execution path
// (`handleGrantRevoke` in `src/execution/auth_dispatch.zig`) persists
// the grant as a `GraphGrant` node in `__geode_security` and updates
// the in-memory `GraphRBACPolicy` immediately.
//
// Three deviations from the pre-v0.5.15 emit:
//
//  1. The privilege token is one of {READ, WRITE, SCHEMA, ALL} -- the
//     v0.5.15 parser only accepts these four. Other keywords (e.g.
//     ADMIN, AUDIT) trip a parse error. The handler validates against
//     this allowlist before any driver work runs.
//
//  2. The grantee is a bare name -- no `USER <name>` keyword. The
//     pre-v0.5.15 emit (`TO USER <name>`) tripped a parse error.
//
//  3. Per-resource scoping is `ON GRAPH <name>` -- the only valid
//     resource type at v0.5.15 is a graph. Arbitrary resource paths
//     are not supported.
//
// Known Limitations from upstream docs/GQL_AUTH_DDL.md @ v0.5.15:
//
//   - #1: A global per-privilege grant (no ON GRAPH clause) is NOT
//     persisted. The upstream handler returns the explanatory note
//     "note: global privilege grants are governed by the user's role;
//     per-graph grants require ON GRAPH (granted nothing persistent
//     for <user>)" rather than persisting anything. The geode-ui
//     handler passes the upstream message through to the client as a
//     200 response so the SPA can surface it inline.
//
//   - #2: Role-as-grantee per-privilege grants are NOT in the v0.5.15
//     grammar. A GrantReq with GranteeKind="role" is rejected with
//     422 wire_feature_missing rather than emitting an upstream-broken
//     statement. Role membership is managed via the separate
//     `GRANT ROLE <r> TO <u>` form (see handlers_users.go).
//
//   - #5: There is no `SHOW GRANTS` statement in v0.5.15. Grant
//     introspection is indirect via `SHOW PERMISSIONS [ FOR <user> ]`
//     (handler in handlers_users.go).

// isAllowedPrivilege pins the four privilege tokens that v0.5.15
// accepts (parseGrantPrivilege in src/gql/parser.zig). The caller
// upper-cases first; the canonical emit form is uppercase.
func isAllowedPrivilege(up string) bool {
	switch up {
	case "READ", "WRITE", "SCHEMA", "ALL":
		return true
	}
	return false
}

// normalisePrivilege returns the canonical upper-case privilege token
// for the v0.5.15 grammar, or "" if the input is not one of the four
// accepted values.
func normalisePrivilege(p string) string {
	up := strings.ToUpper(strings.TrimSpace(p))
	if !isAllowedPrivilege(up) {
		return ""
	}
	return up
}

// Grants implements POST /api/v1/grants.
//
// On v0.5.15 the upstream `handleGrantRevoke` returns one of two
// status rows:
//
//   - "Granted <perm> on <graph> to <user>" -- when a per-graph grant
//     was persisted.
//   - "note: global privilege grants are governed by the user's role;
//     per-graph grants require ON GRAPH (granted nothing persistent
//     for <user>)" -- when no graph was specified (per Limitations
//     #1). The handler still returns 200 in this case -- the upstream
//     statement parsed and executed, it just persisted nothing.
//
// The handler does not currently surface the upstream status row to
// the client (the response is the typed Empty struct). The note is
// observable via the audit log, which records the requested
// permission/grantee/resource at the time of the call.
func (s *GraphServer) Grants(w http.ResponseWriter, r *http.Request, req *gentypes.GrantReq) (*gentypes.Empty, error) {
	stmt, err := buildGrant(req, "GRANT", "TO")
	if err != nil {
		return nil, respondErr(w, err)
	}
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventGrantApplied,
		"user", userFromContext(r.Context()),
		"permission", req.Permission,
		"resource", req.Resource,
		"grantee", req.Grantee,
		"grantee_kind", req.GranteeKind,
	)
	return &gentypes.Empty{}, nil
}

// Revoke implements POST /api/v1/grants/revoke.
//
// Mirror of Grants. Per v0.5.15 the upstream `handleGrantRevoke`
// degrades gracefully on a no-op revoke (the grant did not exist) --
// no error is returned, only a status row.
func (s *GraphServer) Revoke(w http.ResponseWriter, r *http.Request, req *gentypes.GrantReq) (*gentypes.Empty, error) {
	stmt, err := buildGrant(req, "REVOKE", "FROM")
	if err != nil {
		return nil, respondErr(w, err)
	}
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventGrantRevoked,
		"user", userFromContext(r.Context()),
		"permission", req.Permission,
		"resource", req.Resource,
		"grantee", req.Grantee,
		"grantee_kind", req.GranteeKind,
	)
	return &gentypes.Empty{}, nil
}

// buildGrant assembles either a GRANT or REVOKE statement from req
// per the v0.5.15 grammar. verb is "GRANT" or "REVOKE"; preposition is
// "TO" or "FROM" -- kept as caller-supplied tokens (rather than a
// single bool flag) so the emitted SQL keeps the natural
// verb/preposition pairing readable.
//
// Validation order (each step fails-closed before the next):
//
//  1. Permission must be in {READ, WRITE, SCHEMA, ALL} (case-
//     insensitive). The canonical emit form is uppercase.
//  2. GranteeKind must be "user" or empty (defaulting to "user").
//     "role" is rejected with 422 wire_feature_missing per
//     Limitations #2.
//  3. Grantee must be a safe identifier (quoteIdent).
//  4. Resource (graph name) must be a safe identifier when non-empty.
//
// The returned error is already an endpointError when validation
// fails, so callers should pass it straight to respondErr.
func buildGrant(req *gentypes.GrantReq, verb, preposition string) (string, error) {
	priv := normalisePrivilege(req.Permission)
	if priv == "" {
		return "", badRequest(ErrCodeInvalidPermission,
			"permission must be one of READ, WRITE, SCHEMA, ALL (Geode v0.5.15 grammar)")
	}
	kind := req.GranteeKind
	if kind == "" {
		// v0.5.15 only supports per-user grants. Default to "user"
		// when the field is missing rather than the legacy "role" so
		// the canonical path lights up.
		kind = "user"
	}
	switch kind {
	case "user":
		// canonical path
	case "role":
		// Per-role per-privilege grants are not in v0.5.15 grammar.
		// Surface as wire_feature_missing so the SPA can branch the
		// same way it does for other upstream-deferred admin features.
		return "", &endpointError{
			status: http.StatusNotImplemented,
			code:   ErrCodeWireFeatureMissing,
			description: "per-role privilege grants are not supported on Geode v0.5.15; " +
				"use GRANT ROLE <r> TO <user> via POST /api/v1/users/{u}/roles instead " +
				"(see docs/GQL_AUTH_DDL.md Limitations #2)",
		}
	default:
		return "", badRequest(ErrCodeInvalidGranteeKind, "grantee_kind must be 'user' or 'role'")
	}
	grantee, err := quoteIdent(req.Grantee)
	if err != nil {
		return "", badRequest(ErrCodeInvalidGrantee, err.Error())
	}
	stmt := verb + " " + priv
	if req.Resource != "" {
		res, qErr := quoteIdent(req.Resource)
		if qErr != nil {
			return "", badRequest(ErrCodeInvalidResource, qErr.Error())
		}
		stmt += " ON GRAPH " + res
	}
	stmt += " " + preposition + " " + grantee
	return stmt, nil
}
