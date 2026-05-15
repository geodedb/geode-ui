package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Policy handler tests. CREATE POLICY is NOT part of the Geode v0.5.15
// auth DDL surface (Limitations #3 and #7 in upstream
// docs/GQL_AUTH_DDL.md @ v0.5.15). The handler is retained as a
// forward-compatible stub so the SPA can light up automatically when
// upstream lands the CREATE POLICY grammar; until then the call
// returns 501 wire_feature_missing.
//
// Other policy-handler unit tests (TestPolicies_List / TestPolicies_Get
// / TestPolicies_Create / TestPolicies_Delete) live in
// handlers_admin_test.go and exercise the legacy emit shape against a
// canned-success driver -- the canned-success path stays useful for a
// future Geode build that accepts the syntax. The test below pins the
// upstream-deferred contract specifically against v0.5.15.

// TestCreatePolicy_StaysWireFeatureMissingOnV0_5_15 pins the
// upstream-deferred posture for CREATE POLICY on Geode v0.5.15. The
// driver returns the canonical parse-error wire-feature-missing
// signal (status_class=42000 + a parse-error token). The handler must
// wrap this as a 501 wire_feature_missing response so the SPA can
// continue to disable the "+ New policy" CTA.
//
// If a future Geode release ships CREATE POLICY, this test should
// stay green -- the wire_feature_missing fallback only fires on the
// 42000 + parse-error pattern, which a release that *implements* the
// statement will not emit. The path-forward test once upstream lands
// the grammar is TestPolicies_Create in handlers_admin_test.go (which
// drives the canned-success path).
func TestCreatePolicy_StaysWireFeatureMissingOnV0_5_15(t *testing.T) {
	// errWireFeatureMissing is the explicit sentinel; the driver
	// alternatively trips the substring fallback by embedding "42000"
	// and "parse error" in the message. Use the sentinel directly so
	// the test is robust against driver-message drift.
	d := &userDriver{execErr: errWireFeatureMissing}
	s := newUserStubServer(t, "policy_create_wire_feature_missing", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	resp, err := s.PostPolicies(rec, req, &gentypes.PolicyCreateReq{
		Name:       "tenants_iso",
		Expression: "row.tenant_id = ctx.tenant",
		Resource:   "Customer",
	})
	if err != nil {
		t.Fatalf("PostPolicies returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil on wire_feature_missing", resp)
	}
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status=%d want 501 (wire_feature_missing on v0.5.15) body=%s",
			rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "wire_feature_missing") {
		t.Errorf("body=%s want wire_feature_missing", rec.Body.String())
	}
	// The handler emitted the statement and the driver intercepted
	// it; we don't pin the exact emit shape since the v0.5.15 grammar
	// for CREATE POLICY is still TBD upstream.
	if got := d.seen(); len(got) == 0 {
		t.Errorf("driver saw no statements; expected at least one CREATE POLICY emit")
	}
}

// TestCreatePolicy_StaysWireFeatureMissingOnSubstringFallback covers
// the same upstream-deferred posture but via the substring fallback
// in isWireFeatureMissing (a driver that does not export the typed
// statusClasser interface but emits the canonical "geode: 42000:
// parse error: ..." string). Two signal sources, one outcome: SPA
// still gets 501.
func TestCreatePolicy_StaysWireFeatureMissingOnSubstringFallback(t *testing.T) {
	d := &userDriver{execErr: errors.New("geode: 42000: parse error: expected token CREATE POLICY")}
	s := newUserStubServer(t, "policy_create_wire_feature_missing_substring", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", nil)
	resp, err := s.PostPolicies(rec, req, &gentypes.PolicyCreateReq{
		Name:       "tenants_iso",
		Expression: "true",
	})
	if err != nil {
		t.Fatalf("PostPolicies returned err %v; want nil with inline body", err)
	}
	if resp != nil {
		t.Fatalf("resp=%v want nil", resp)
	}
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status=%d want 501 body=%s", rec.Code, rec.Body.String())
	}
}
