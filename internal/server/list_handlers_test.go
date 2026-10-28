package server

import (
	"database/sql/driver"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// Empty-result / wire-feature-missing rule (GAP-Q22 / #168).
//
// Pinned invariant: a list endpoint always serialises its slice field(s)
// as a JSON array ([], never null) on a no-results upstream — and the
// admin-RBAC list endpoints additionally tolerate an
// isWireFeatureMissing upstream by degrading to an empty 200 list rather
// than surfacing a 4xx. (Single-resource lookups keep their 404
// *_not_found behaviour — that split is exercised elsewhere and not
// changed here.)
//
// The handler return value is what the generated wrapper marshals onto
// the wire, so we marshal it with encoding/json/v2 and assert the
// rendered body has the array form. A regression that re-introduces a
// `var out []T` (which marshals as null) would fail these.

// errParse42000 is the canonical upstream parse-error that
// isWireFeatureMissing recognises (status_class 42000 + parse tokens).
// Mirrors the rows used in errors_test.go.
var errParse42000 = errors.New("geode: 42000: parse error near token")

// mustMarshalArrayField marshals v and asserts (a) the rendered JSON
// contains `"<field>":[` (an array open) and never `"<field>":null`, and
// (b) every exported slice field of v is non-nil at the Go level — the
// "non-nil empty slice" half of #168. (encoding/json/v2 already renders
// a nil slice as [] rather than null, so the wire form is correct either
// way; the Go-level non-nil assertion pins the handler-side contract
// independently of the codec's behaviour.)
func mustMarshalArrayField(t *testing.T, v any, fields ...string) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal %T: %v", v, err)
	}
	body := string(raw)
	for _, f := range fields {
		nullForm := `"` + f + `":null`
		arrForm := `"` + f + `":[`
		if strings.Contains(body, nullForm) {
			t.Errorf("field %q rendered as null in %s — list endpoints must return [] on no results", f, body)
		}
		if !strings.Contains(body, arrForm) {
			t.Errorf("field %q not rendered as a JSON array in %s", f, body)
		}
	}
	// Go-level non-nil check on every exported slice field.
	rv := reflect.ValueOf(v)
	for rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			t.Fatalf("%T is a nil pointer", v)
		}
		rv = rv.Elem()
	}
	if rv.Kind() == reflect.Struct {
		rt := rv.Type()
		for i := range rv.NumField() {
			fv := rv.Field(i)
			if fv.Kind() == reflect.Slice && fv.IsNil() {
				t.Errorf("%s.%s is a nil slice — list endpoints must return a non-nil empty slice on no results", rt.Name(), rt.Field(i).Name)
			}
		}
	}
	return body
}

func TestListHandlers_EmptyResult_NonNilSlices(t *testing.T) {
	// (handler-name, the GraphServer method, request, response slice fields)
	type listCase struct {
		name   string
		fields []string
		run    func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error)
	}
	cases := []listCase{
		{
			name:   "GetRoles",
			fields: []string{"roles"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetRoles(rec, httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetPolicies",
			fields: []string{"policies"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetPolicies(rec, httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetBackups",
			fields: []string{"backups"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetBackups(rec, httptest.NewRequest(http.MethodGet, "/api/v1/backups", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetUsers",
			fields: []string{"users"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetUsers(rec, httptest.NewRequest(http.MethodGet, "/api/v1/users", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetMigrations",
			fields: []string{"pending", "applied"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetMigrations(rec, httptest.NewRequest(http.MethodGet, "/api/v1/migrations", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "Graphs",
			fields: []string{"graphs"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.Graphs(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graphs", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "EdgeTypes",
			fields: []string{"types"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.EdgeTypes(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graphs/g/edge-types", nil), &gentypes.GraphParam{Graph: "g"})
			},
		},
		{
			name:   "Labels",
			fields: []string{"labels"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.Labels(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graphs/g/labels", nil), &gentypes.GraphParam{Graph: "g"})
			},
		},
		{
			name:   "Indexes",
			fields: []string{"indexes"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.Indexes(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graphs/g/indexes", nil), &gentypes.GraphParam{Graph: "g"})
			},
		},
		{
			name:   "Constraints",
			fields: []string{"constraints"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.Constraints(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graphs/g/constraints", nil), &gentypes.GraphParam{Graph: "g"})
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Empty row set (no error).
			d := &userDriver{cols: []string{"name"}, rows: [][]driver.Value{}}
			s := newUserStubServer(t, "list_empty_"+strings.ToLower(tc.name), d)
			rec := httptest.NewRecorder()
			resp, err := tc.run(s, rec)
			if err != nil {
				t.Fatalf("%s on empty result: %v", tc.name, err)
			}
			if resp == nil {
				t.Fatalf("%s returned nil response on empty result", tc.name)
			}
			mustMarshalArrayField(t, resp, tc.fields...)
		})
	}
}

// TestListHandlers_WireFeatureMissing_EmptyList pins the second half of
// the rule: the admin-RBAC list endpoints (and GetMigrations) swallow an
// isWireFeatureMissing upstream and return a 200 with empty arrays, NOT
// a 4xx/5xx.
func TestListHandlers_WireFeatureMissing_EmptyList(t *testing.T) {
	type wireCase struct {
		name   string
		fields []string
		run    func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error)
	}
	cases := []wireCase{
		{
			name:   "GetRoles",
			fields: []string{"roles"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetRoles(rec, httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetPolicies",
			fields: []string{"policies"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetPolicies(rec, httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetBackups",
			fields: []string{"backups"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetBackups(rec, httptest.NewRequest(http.MethodGet, "/api/v1/backups", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetUsers",
			fields: []string{"users"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetUsers(rec, httptest.NewRequest(http.MethodGet, "/api/v1/users", nil), &gentypes.Empty{})
			},
		},
		{
			name:   "GetMigrations",
			fields: []string{"pending", "applied"},
			run: func(s *GraphServer, rec *httptest.ResponseRecorder) (any, error) {
				return s.GetMigrations(rec, httptest.NewRequest(http.MethodGet, "/api/v1/migrations", nil), &gentypes.Empty{})
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &userDriver{queryErr: errParse42000}
			s := newUserStubServer(t, "list_wiremissing_"+strings.ToLower(tc.name), d)
			rec := httptest.NewRecorder()
			resp, err := tc.run(s, rec)
			if err != nil {
				t.Fatalf("%s on wire-feature-missing upstream: returned error %v (want graceful empty list)", tc.name, err)
			}
			if resp == nil {
				t.Fatalf("%s returned nil response on wire-feature-missing upstream", tc.name)
			}
			if rec.Code != 0 && rec.Code != http.StatusOK {
				t.Fatalf("%s wrote HTTP %d on wire-feature-missing upstream; want 200/unwritten", tc.name, rec.Code)
			}
			mustMarshalArrayField(t, resp, tc.fields...)
		})
	}
}

// TestAudit_EmptyResult_NonNilEntries pins the Audit list endpoint
// (which doesn't go through connDB — it reads the in-process ring).
func TestAudit_EmptyResult_NonNilEntries(t *testing.T) {
	s := New(Config{Version: "test"})
	// A far-future `since` guarantees an empty snapshot.
	resp, err := s.Audit(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodGet, "/api/v1/audit?since=2999-01-01T00:00:00Z", nil),
		&gentypes.AuditQuery{Since: "2999-01-01T00:00:00Z"})
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if resp == nil {
		t.Fatal("Audit returned nil response on empty result")
	}
	mustMarshalArrayField(t, resp, "entries")
}
