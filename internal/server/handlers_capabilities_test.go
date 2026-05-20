package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	genapi "geodedb.com/geode-ui/gen/api"
	gentypes "geodedb.com/geode-ui/gen/types"
)

// Phase-1 reproduction test for the Admin-section overhaul.
//
// The SPA gates the "+ New user/role/policy" CTAs and the Grants
// Apply/Revoke buttons behind a new `GET /api/v1/capabilities` endpoint
// that reports whether the connected Geode build accepts the admin DDL
// (CREATE USER/ROLE/POLICY, GRANT). Against a v0.5.11-class build none
// of those are supported, so every `admin_writable.*` flag must be
// `false`.
//
// On current code the route does not exist (it has not been added to
// geode.json / regenerated into gen/api), so the mux returns 404 and
// this test FAILS — which is the intended red. When the endpoint lands,
// the handler must return 200 with the documented shape and all flags
// false against a build that lacks admin DDL.
//
// NOTE: this test deliberately decodes the body into a generic
// map[string]any rather than a generated `Capabilities` struct so that
// it compiles (gofmt/vet clean) against the *current* gen/ tree. The
// fixer may tweak the exact field names; if so, update the lookups
// below to match — the contract pinned here is "the endpoint exists,
// returns 200, carries a geode version string, and reports false for
// users/roles/policies/grants against the current connected build".
func TestCapabilities_AdminDDLUnsupportedBuild(t *testing.T) {
	srv, _ := newTestServerWithStore(t)

	// Mirror the auth stub used by handlers_profiles_crud_test.go so the
	// generated mux middleware lets the request through.
	stubAuthJWT := func(r *http.Request) error {
		ctx := r.Context()
		ctx = context.WithValue(ctx, userCtxKey, "alice")
		ctx = context.WithValue(ctx, rolesCtxKey, []string{"admin"})
		*r = *r.WithContext(ctx)
		return nil
	}

	mux := http.NewServeMux()
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{AuthJWT: stubAuthJWT})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/v1/capabilities")
	if err != nil {
		t.Fatalf("GET /api/v1/capabilities: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/capabilities: status=%d body=%q; want 200 "+
			"(route not yet defined in geode.json / gen/api — this is the "+
			"expected pre-fix failure)", resp.StatusCode, string(body))
	}

	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode capabilities body %q: %v", string(body), err)
	}

	if v, ok := got["geode_version"].(string); !ok || v == "" {
		t.Errorf("capabilities.geode_version = %v; want a non-empty string", got["geode_version"])
	}

	aw, ok := got["admin_writable"].(map[string]any)
	if !ok {
		t.Fatalf("capabilities.admin_writable missing/not an object: %v", got["admin_writable"])
	}
	for _, k := range []string{"users", "roles", "policies", "grants"} {
		v, present := aw[k]
		if !present {
			t.Errorf("admin_writable.%s missing", k)
			continue
		}
		if b, isBool := v.(bool); !isBool || b {
			t.Errorf("admin_writable.%s = %v; want false (connected build lacks admin DDL)", k, v)
		}
	}
}

// v0.5.15 Auth-DDL probe tests --------------------------------------------
//
// These tests pin the Q53 (#198) closure: GetCapabilities must probe the
// connected Geode build via `SHOW CAPABILITIES` + `SHOW VERSION` rather
// than hardcoding `admin_writable={false,false,false,false}`.
//
// Upstream column truth (admin_ddl.zig @ v0.5.15 — executeShowCapabilities):
//
//	columns: ["feature", "supported"]   // supported is a *string* "true"/"false"
//	features:
//	  auth_ddl, admin_writable, role_ddl, grant_ddl, show_permissions,
//	  show_version  (all supported=true on v0.5.15)
//	  policy_ddl, fle_ddl, tenant_ddl  (supported=false)
//
// The SPA contract (src/api/capabilities.ts) flattens these into the
// four bool flags admin_writable.{users,roles,policies,grants}. Mapping:
//
//	users    -> auth_ddl
//	roles    -> role_ddl
//	grants   -> grant_ddl
//	policies -> policy_ddl  (still false on v0.5.15 per Limitations #3)
//
// SHOW VERSION returns a single-row, single-column `version` result.

// TestGetCapabilities_PopulatesFromShowCapabilities verifies the happy
// path against a v0.5.15-class server: SHOW VERSION returns the build
// string, SHOW CAPABILITIES returns the v0.5.15 feature snapshot, and
// the response flattens to admin_writable.users/roles/grants=true,
// policies=false.
func TestGetCapabilities_PopulatesFromShowCapabilities(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW VERSION": {
			cols: []string{"version"},
			rows: [][]driver.Value{{"0.5.15"}},
		},
		"SHOW CAPABILITIES": {
			cols: []string{"feature", "supported"},
			// Upstream emits "true"/"false" strings, not bools — match that.
			rows: [][]driver.Value{
				{"auth_ddl", "true"},
				{"admin_writable", "true"},
				{"role_ddl", "true"},
				{"grant_ddl", "true"},
				{"show_permissions", "true"},
				{"show_version", "true"},
				{"policy_ddl", "false"},
				{"fle_ddl", "false"},
				{"tenant_ddl", "false"},
			},
		},
	}}
	s := newStubServer(t, "fake_caps_v0_5_15", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	resp, err := s.GetCapabilities(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if resp == nil {
		t.Fatalf("GetCapabilities returned nil response")
	}
	if resp.GeodeVersion != "0.5.15" {
		t.Errorf("geode_version=%q want %q (read from SHOW VERSION)", resp.GeodeVersion, "0.5.15")
	}
	var aw map[string]bool
	if err := json.Unmarshal(resp.AdminWritable, &aw); err != nil {
		t.Fatalf("decode admin_writable %s: %v", string(resp.AdminWritable), err)
	}
	wantTrue := []string{"users", "roles", "grants"}
	for _, k := range wantTrue {
		if !aw[k] {
			t.Errorf("admin_writable.%s=false; want true (v0.5.15 supports auth/role/grant DDL)", k)
		}
	}
	if aw["policies"] {
		t.Errorf("admin_writable.policies=true; want false (CREATE POLICY still upstream-deferred)")
	}
}

// TestGetCapabilities_MetricsEnabled — the proxy capability flag.
// cfg.MetricsURL is empty by default (the SPA hides the metric
// cards); setting it to a non-empty URL flips the flag to true so
// the SPA can render the cards eagerly even before the first
// /api/v1/metrics fetch lands.
func TestGetCapabilities_MetricsEnabled(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW VERSION": {
			cols: []string{"version"},
			rows: [][]driver.Value{{"0.5.19"}},
		},
		"SHOW CAPABILITIES": {
			cols: []string{"feature", "supported"},
			rows: [][]driver.Value{},
		},
	}}
	registerFakeDriver("fake_caps_metrics_off", d)
	dbOff, err := sql.Open("fake_caps_metrics_off", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = dbOff.Close() })
	srvOff := New(Config{
		Version: "test",
		Pool:    &stubPool{db: dbOff},
	})
	respOff, err := srvOff.GetCapabilities(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil),
		&gentypes.Empty{},
	)
	if err != nil {
		t.Fatalf("GetCapabilities (off): %v", err)
	}
	if respOff.MetricsEnabled {
		t.Error("metrics_enabled=true with empty MetricsURL; want false")
	}

	registerFakeDriver("fake_caps_metrics_on", d)
	dbOn, err := sql.Open("fake_caps_metrics_on", "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	t.Cleanup(func() { _ = dbOn.Close() })
	srvOn := New(Config{
		Version:    "test",
		Pool:       &stubPool{db: dbOn},
		MetricsURL: "http://geode:9090/metrics",
	})
	respOn, err := srvOn.GetCapabilities(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil),
		&gentypes.Empty{},
	)
	if err != nil {
		t.Fatalf("GetCapabilities (on): %v", err)
	}
	if !respOn.MetricsEnabled {
		t.Error("metrics_enabled=false with non-empty MetricsURL; want true")
	}
}

// TestGetCapabilities_LegacyServerGetsAllFalse verifies the fallback
// path: an older Geode build that does not implement SHOW CAPABILITIES /
// SHOW VERSION (parser returns a wire-feature-missing-class error) must
// resolve to 200 OK with all flags false and geode_version derived from
// the geode-ui build version. The current SPA gates the create CTAs on
// these flags so a 5xx here would break every Admin page.
func TestGetCapabilities_LegacyServerGetsAllFalse(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		// Both probes trip the parse-error fallback that isWireFeatureMissing
		// recognises (see errors.go wireFeatureMissingSubstrings).
		"SHOW VERSION":      {err: errors.New("parse error: expected token")},
		"SHOW CAPABILITIES": {err: errors.New("parse error: expected token")},
	}}
	s := newStubServer(t, "fake_caps_legacy", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	resp, err := s.GetCapabilities(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetCapabilities (legacy): %v", err)
	}
	if resp == nil {
		t.Fatalf("GetCapabilities returned nil response on legacy fallback")
	}
	// Probe failed -> geode_version falls back to the geode-ui build
	// version (cfg.Version, which newStubServer sets to "test").
	if resp.GeodeVersion != "test" {
		t.Errorf("geode_version=%q; want %q (legacy fallback to cfg.Version)", resp.GeodeVersion, "test")
	}
	var aw map[string]bool
	if err := json.Unmarshal(resp.AdminWritable, &aw); err != nil {
		t.Fatalf("decode admin_writable: %v", err)
	}
	for _, k := range []string{"users", "roles", "policies", "grants"} {
		if aw[k] {
			t.Errorf("admin_writable.%s=true on legacy build; want false", k)
		}
	}
}

// TestGetCapabilities_PopulatesGeodeVersion isolates the SHOW VERSION
// path: even when SHOW CAPABILITIES returns nothing recognisable, the
// version string should still be picked up.
func TestGetCapabilities_PopulatesGeodeVersion(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW VERSION": {
			cols: []string{"version"},
			rows: [][]driver.Value{{"0.5.15"}},
		},
		"SHOW CAPABILITIES": {
			// No recognised rows -> all flags should remain false but
			// version must still come from the dedicated probe.
			cols: []string{"feature", "supported"},
			rows: [][]driver.Value{},
		},
	}}
	s := newStubServer(t, "fake_caps_version_only", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	resp, err := s.GetCapabilities(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if resp.GeodeVersion != "0.5.15" {
		t.Errorf("geode_version=%q want %q", resp.GeodeVersion, "0.5.15")
	}
	var aw map[string]bool
	if err := json.Unmarshal(resp.AdminWritable, &aw); err != nil {
		t.Fatalf("decode admin_writable: %v", err)
	}
	for _, k := range []string{"users", "roles", "policies", "grants"} {
		if aw[k] {
			t.Errorf("admin_writable.%s=true with no SHOW CAPABILITIES rows; want false", k)
		}
	}
}

// TestGetCapabilities_PolicyFlagFollowsUpstream pins the
// users/roles/grants=true + policies=false split when the upstream
// `policy_ddl` capability is explicitly false. This is the contract
// documented in docs/GQL_AUTH_DDL.md Limitations #3.
func TestGetCapabilities_PolicyFlagFollowsUpstream(t *testing.T) {
	d := &fakeDriver{rows: map[string]fakeResult{
		"SHOW VERSION": {
			cols: []string{"version"},
			rows: [][]driver.Value{{"0.5.15"}},
		},
		"SHOW CAPABILITIES": {
			cols: []string{"feature", "supported"},
			rows: [][]driver.Value{
				{"auth_ddl", "true"},
				{"role_ddl", "true"},
				{"grant_ddl", "true"},
				{"policy_ddl", "false"},
			},
		},
	}}
	s := newStubServer(t, "fake_caps_policy_split", d)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	resp, err := s.GetCapabilities(rec, req, &gentypes.Empty{})
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	var aw map[string]bool
	if err := json.Unmarshal(resp.AdminWritable, &aw); err != nil {
		t.Fatalf("decode admin_writable: %v", err)
	}
	if !aw["users"] || !aw["roles"] || !aw["grants"] {
		t.Errorf("admin_writable users/roles/grants must all be true on v0.5.15: %v", aw)
	}
	if aw["policies"] {
		t.Errorf("admin_writable.policies=true; want false while policy_ddl is upstream-deferred")
	}
}
