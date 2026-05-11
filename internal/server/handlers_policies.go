package server

import (
	"encoding/json/v2"
	"fmt"
	"net/http"

	"encoding/json/jsontext"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// RLS policy handlers — admin endpoints under /api/v1/policies.
//
// The genapi-emitted method names in this surface are:
//
//   GetPolicies  → GET    /api/v1/policies
//   PostPolicies → POST   /api/v1/policies
//   GetName      → GET    /api/v1/policies/{name}
//   DeleteName   → DELETE /api/v1/policies/{name}
//
// Naming: the path-param leaf is `{name}` so the disambiguator collapses
// the per-id verbs to GetName/DeleteName. The Go-private surface area
// is fine — the routes are exercised only via the generated mux and
// the unit tests below.
//
// GQL syntax: `CREATE POLICY <name> [ON <resource>] AS '<expression>'`
// is the forward-compatible form; Geode 0.3.8 ships a `policy create`
// CLI subcommand that talks directly to the security graph rather than
// accepting that statement over the wire. Handlers emit the statement
// anyway so the UI picks up wire support automatically.

// GetPolicies implements GET /api/v1/policies (list policies).
func (s *GraphServer) GetPolicies(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.PolicyList, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW POLICIES")
	if err != nil {
		if isWireFeatureMissing(err) {
			return &gentypes.PolicyList{Policies: []jsontext.Value{}}, nil
		}
		return nil, respondErr(w, wireErr(err))
	}
	out := make([]jsontext.Value, 0, len(rows))
	for _, row := range rows {
		obj := rowToMap(cols, row)
		raw, mErr := json.Marshal(obj)
		if mErr != nil {
			return nil, fmt.Errorf("marshal policy row: %w", mErr)
		}
		out = append(out, jsontext.Value(raw))
	}
	return &gentypes.PolicyList{Policies: out}, nil
}

// PostPolicies implements POST /api/v1/policies (create policy).
func (s *GraphServer) PostPolicies(w http.ResponseWriter, r *http.Request, req *gentypes.PolicyCreateReq) (*gentypes.Policy, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	pname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_policy_name", err.Error()))
	}
	expr, err := quoteString(req.Expression)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_expression", err.Error()))
	}
	stmt := "CREATE POLICY " + pname
	if req.Resource != "" {
		res, qErr := quoteIdent(req.Resource)
		if qErr != nil {
			return nil, respondErr(w, badRequest("invalid_resource", qErr.Error()))
		}
		stmt += " ON " + res
	}
	stmt += " AS " + expr
	if _, err := runStatement(r.Context(), db, stmt); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventPolicyCreated,
		"user", userFromContext(r.Context()),
		"policy", req.Name,
		"resource", req.Resource,
	)
	return &gentypes.Policy{
		Name:       req.Name,
		Expression: req.Expression,
		Resource:   req.Resource,
	}, nil
}

// GetName implements GET /api/v1/policies/{name}.
func (s *GraphServer) GetName(w http.ResponseWriter, r *http.Request, req *gentypes.PolicyParam) (*gentypes.Policy, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	pname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_policy_name", err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW POLICY "+pname)
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		return nil, respondErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        "policy_not_found",
			description: "policy " + req.Name + " does not exist",
		})
	}
	return policyFromRow(cols, rows[0]), nil
}

// DeleteName implements DELETE /api/v1/policies/{name}.
func (s *GraphServer) DeleteName(w http.ResponseWriter, r *http.Request, req *gentypes.PolicyParam) (*gentypes.Empty, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	pname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest("invalid_policy_name", err.Error()))
	}
	if _, err := runStatement(r.Context(), db, "DROP POLICY "+pname); err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	emitAudit(auditEventPolicyDeleted,
		"user", userFromContext(r.Context()),
		"policy", req.Name,
	)
	return &gentypes.Empty{}, nil
}

// policyFromRow projects a SHOW POLICY row onto the typed Policy schema.
func policyFromRow(cols []string, row []any) *gentypes.Policy {
	p := &gentypes.Policy{}
	for i, c := range cols {
		if i >= len(row) {
			break
		}
		switch c {
		case "name", "policy":
			p.Name = asStr(row[i])
		case "expression":
			p.Expression = asStr(row[i])
		case "resource":
			p.Resource = asStr(row[i])
		}
	}
	return p
}
