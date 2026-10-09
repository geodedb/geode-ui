package server

import (
	"encoding/json/v2"
	"net/http"
	"os"
	"testing"
)

// TestGeodeJSONQueryRateLimit pins the per-route rate limit for
// POST /api/v1/query in the genapi spec to the documented ~2000-rps SLO
// (see docs/ARCHITECTURE.md). If a future spec edit drifts this value,
// this test fails -- forcing a deliberate decision and a docs update.
// Resolves #159.
func TestGeodeJSONQueryRateLimit(t *testing.T) {
	const want = 2000

	// geode.json lives at the repo root; this test runs from internal/server/.
	raw, err := os.ReadFile("../../geode.json")
	if err != nil {
		t.Fatalf("read geode.json: %v", err)
	}

	var spec struct {
		API []struct {
			Method    string `json:"method"`
			Path      string `json:"path"`
			RateLimit *int   `json:"rateLimit"`
		} `json:"api"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse geode.json: %v", err)
	}

	var found bool
	for _, r := range spec.API {
		if r.Method == http.MethodPost && r.Path == "/api/v1/query" {
			found = true
			if r.RateLimit == nil {
				t.Fatalf("POST /api/v1/query has no rateLimit in geode.json; want %d", want)
			}
			if *r.RateLimit != want {
				t.Fatalf("POST /api/v1/query rateLimit = %d; want %d (the documented ~2000-rps SLO -- see docs/ARCHITECTURE.md and #159)", *r.RateLimit, want)
			}
		}
	}
	if !found {
		t.Fatal("POST /api/v1/query route not found in geode.json -- spec shape changed; update this test")
	}
}
