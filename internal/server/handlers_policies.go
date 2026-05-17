package server

import (
	"net/http"

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
// UPSTREAM STATUS (Geode v0.5.15): CREATE POLICY is NOT part of the
// v0.5.15 grammar. The four upstream Limitations from
// docs/GQL_AUTH_DDL.md @ v0.5.15 that apply here:
//
//   #3: "RLS policy persistence is not yet implemented. CREATE POLICY
//       grammar and g_policies persistence are tracked separately --
//       use CALL geode.fle.* for FLE management and the RLS engine
//       API for row-level security until that lands."
//   #7: "CREATE POLICY, FLE DDL, and tenant DDL are not part of this
//       surface."
//
// Upstream notes the *future* CREATE POLICY grammar will look like:
//
//	CREATE POLICY <name> ON <Label>
//	  [ FOR READ | WRITE | ALL ]
//	  [ TO <role> [, <role>]* ]
//	  USING (<expr>)
//	  [ WITH CHECK (<expr>) ]
//
// matching the existing src/security/rls_core.zig Policy struct
// (graph, table, operation, roles, using_expr, check_expr). The
// geode-ui's current "CREATE POLICY <name> [ON <resource>] AS
// '<expr>'" form may be supported as a forward-compat alias once the
// parser path lands, but is NOT accepted by v0.5.15.
//
// Until then, calls to PostPolicies / DeleteName / GetName / GetPolicies
// return 501 wire_feature_missing via the standard wireErr fallback when
// the connected build is v0.5.15. The SPA gates the "+ New policy" CTA
// on capabilities.admin_writable.policies which handlers_capabilities.go
// reports as false against any build that reports policy_ddl=false in
// SHOW CAPABILITIES (v0.5.15 reports false; Limitations #3 / #7 cover
// this explicitly). Do not remove the wire_feature_missing fallback in
// any of the handlers below -- it is the load-bearing degradation path
// for the SPA's gate.

// GetPolicies implements GET /api/v1/policies (list policies).
//
// GAP-033 / #138: delegates SHOW-row marshalling to
// listRowsAsJSONValues; same pattern as GetBackups / GetRoles.
func (s *GraphServer) GetPolicies(w http.ResponseWriter, r *http.Request, _ *gentypes.Empty) (*gentypes.PolicyList, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	out, lErr := listRowsAsJSONValues(r.Context(), db, "SHOW POLICIES", "policy", nil)
	if lErr != nil {
		return nil, respondErr(w, lErr)
	}
	return &gentypes.PolicyList{Policies: out}, nil
}

// PostPolicies implements POST /api/v1/policies (create policy).
//
// CreatePolicy is a placeholder for the future GQL CREATE POLICY
// syntax (see ~/src/devnw/codepros/geode/geode/docs/GQL_AUTH_DDL.md
// "Future: CREATE POLICY"). Until Geode lands this, the call returns
// 501 wire_feature_missing through the standard wireErr fallback and
// the SPA gates the CTA via admin_writable.policies (which Task 3 of
// the v0.5.15 plan reports as false on v0.5.15 -- see
// handlers_capabilities.go). Do not remove the wire_feature_missing
// fallback here -- it is the SPA's degradation signal.
//
// Tested by TestCreatePolicy_StaysWireFeatureMissingOnV0_5_15 in
// handlers_policies_test.go.
func (s *GraphServer) PostPolicies(w http.ResponseWriter, r *http.Request, req *gentypes.PolicyCreateReq) (*gentypes.Policy, error) {
	db, err := s.connDB(r.Context())
	if err != nil {
		return nil, respondErr(w, err)
	}
	pname, err := quoteIdent(req.Name)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidPolicyName, err.Error()))
	}
	expr, err := quoteString(req.Expression)
	if err != nil {
		return nil, respondErr(w, badRequest(ErrCodeInvalidExpression, err.Error()))
	}
	stmt := "CREATE POLICY " + pname
	if req.Resource != "" {
		res, qErr := quoteIdent(req.Resource)
		if qErr != nil {
			return nil, respondErr(w, badRequest(ErrCodeInvalidResource, qErr.Error()))
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
		return nil, respondErr(w, badRequest(ErrCodeInvalidPolicyName, err.Error()))
	}
	rows, cols, err := runQuery(r.Context(), db, "SHOW POLICY "+pname)
	if err != nil {
		return nil, respondErr(w, wireErr(err))
	}
	if len(rows) == 0 {
		return nil, respondErr(w, &endpointError{
			status:      http.StatusNotFound,
			code:        ErrCodePolicyNotFound,
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
		return nil, respondErr(w, badRequest(ErrCodeInvalidPolicyName, err.Error()))
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
