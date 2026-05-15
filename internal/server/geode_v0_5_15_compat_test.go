//go:build integration

package server

import (
	"context"
	"database/sql"
	"os"
	"testing"
)

// TestGeodeV0_5_15_AuthDDLSurface is an integration test that exercises the
// v0.5.15 auth DDL grammar via a real Geode driver. Skipped unless
// GEODE_INTEGRATION_DSN is set in the environment.
//
// Output (column lists + first row of each result) is the source of truth
// for the column pinning in handler tasks 3, 4, 5, 6 of the
// 2026-05-13-geode-0-5-15-auth-ddl-integration plan.
func TestGeodeV0_5_15_AuthDDLSurface(t *testing.T) {
	dsn := os.Getenv("GEODE_INTEGRATION_DSN")
	if dsn == "" {
		t.Skip("set GEODE_INTEGRATION_DSN to run against a live v0.5.15 server")
	}
	db, err := sql.Open("geode", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	cases := []struct{ name, stmt string }{
		{"show_version", "SHOW VERSION"},
		{"show_capabilities", "SHOW CAPABILITIES"},
		{"show_users", "SHOW USERS"},
		{"show_roles", "SHOW ROLES"},
		{"show_permissions_self", "SHOW PERMISSIONS"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, cols, err := runQuery(context.Background(), db, tc.stmt)
			if err != nil {
				t.Fatalf("%s: %v", tc.stmt, err)
			}
			t.Logf("%s columns: %v", tc.stmt, cols)
			t.Logf("%s row count: %d", tc.stmt, len(rows))
			if len(rows) > 0 {
				t.Logf("%s first row: %v", tc.stmt, rows[0])
			}
		})
	}
}
