package server

import (
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Grant/Revoke handlers — admin endpoints under /api/v1/grants.
//
// The genapi-emitted method names in this surface are:
//
//   Grants → POST /api/v1/grants
//   Revoke → POST /api/v1/grants/revoke
//
// GQL syntax (forward-compatible — Geode 0.3.8 ships a `grant`/`revoke`
// CLI subcommand that bypasses the wire and writes directly to the
// security graph):
//
//   GRANT <perm> [ON <resource>] TO USER `name`
//   GRANT <perm> [ON <resource>] TO ROLE `name`
//   REVOKE <perm> [ON <resource>] FROM USER `name`
//   REVOKE <perm> [ON <resource>] FROM ROLE `name`
//
// Permissions are quoted as identifiers (backticks) — they are
// keyword-shaped tokens like READ/WRITE/ADMIN in standard GQL but the
// project does not pin a fixed allowlist (the server-side parser is
// the source of truth for which permission names are valid). Doing the
// same backtick quoting we use for usernames keeps the values
// injection-safe regardless of which keywords Geode adds in future.
//
// `grantee_kind` validates as one of "user", "role", or "" (default
// "role"); the schema's enum allows "" so an old client that omits
// the field still produces a sensible request.

// Grants implements POST /api/v1/grants.
func (s *GraphServer) Grants(w http.ResponseWriter, r *http.Request, req *gentypes.GrantReq) (*gentypes.Empty, error) {
	stmt, err := buildGrant(req, "GRANT", "TO")
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	return &gentypes.Empty{}, nil
}

// Revoke implements POST /api/v1/grants/revoke.
func (s *GraphServer) Revoke(w http.ResponseWriter, r *http.Request, req *gentypes.GrantReq) (*gentypes.Empty, error) {
	stmt, err := buildGrant(req, "REVOKE", "FROM")
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	db, err := s.userDB(r.Context())
	if err != nil {
		return nil, userResponseErr(w, err)
	}
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, userResponseErr(w, userErr(err))
	}
	return &gentypes.Empty{}, nil
}

// buildGrant assembles either a GRANT or REVOKE statement from req.
// verb is "GRANT" or "REVOKE"; preposition is "TO" or "FROM" — kept
// as caller-supplied tokens (rather than a single bool flag) so the
// emitted SQL keeps the natural verb/preposition pairing readable.
//
// The returned error is already an endpointError when validation
// fails, so callers should pass it straight to userResponseErr.
func buildGrant(req *gentypes.GrantReq, verb, preposition string) (string, error) {
	perm, err := quoteIdent(req.Permission)
	if err != nil {
		return "", badRequest("invalid_permission", err.Error())
	}
	grantee, err := quoteIdent(req.Grantee)
	if err != nil {
		return "", badRequest("invalid_grantee", err.Error())
	}
	kind := req.GranteeKind
	if kind == "" {
		kind = "role"
	}
	var subject string
	switch kind {
	case "user":
		subject = "USER " + grantee
	case "role":
		subject = "ROLE " + grantee
	default:
		// The Valid()-time enum check would normally catch this, but
		// keep an explicit guard so direct in-process callers (tests)
		// also get a 400 on bad kinds.
		return "", badRequest("invalid_grantee_kind", "grantee_kind must be 'user' or 'role'")
	}
	stmt := verb + " " + perm
	if req.Resource != "" {
		res, qErr := quoteIdent(req.Resource)
		if qErr != nil {
			return "", badRequest("invalid_resource", qErr.Error())
		}
		stmt += " ON " + res
	}
	stmt += " " + preposition + " " + subject
	return stmt, nil
}
