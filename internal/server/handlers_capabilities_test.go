package server

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	genapi "geodedb.com/geode-ui/gen/api"
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
