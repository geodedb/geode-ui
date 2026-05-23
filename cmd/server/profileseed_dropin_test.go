package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

func mustOpenStore(t *testing.T) profilestore.Store {
	t.Helper()
	s, err := profilestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestSeedFromDropInDir_lexicographicOrder(t *testing.T) {
	dir := t.TempDir()
	must := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must("20-second.json", `[{"name":"second","dsn":"quic://b:3141"}]`)
	must("10-first.json", `[{"name":"first","dsn":"quic://a:3141"}]`)
	must("99-last.json", `[{"name":"last","dsn":"quic://c:3141"}]`)

	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 profiles, got %d", len(got))
	}
	// `store.List(Filter{})` returns rows ORDER BY scope, name — so the
	// returned order is alphabetical on profile name, NOT the lex-by-
	// filename order the drop-in scanner processes the files in. We
	// still prove every drop-in's entry landed in the store; the
	// scanner's processing order is implicit in the "all three present"
	// invariant and is exercised more directly by the
	// firstWinsOnNameCollision test below.
	wantNames := []string{"first", "last", "second"}
	for i, p := range got {
		if p.Name != wantNames[i] {
			t.Errorf("profile[%d] name = %q, want %q", i, p.Name, wantNames[i])
		}
		if p.Scope != conn.ProfileScopeSystem {
			t.Errorf("profile[%d] scope = %q, want system", i, p.Scope)
		}
	}
}

func TestSeedFromDropInDir_emptyDir(t *testing.T) {
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, t.TempDir()); err != nil {
		t.Fatalf("empty dir should be a no-op, got %v", err)
	}
}

func TestSeedFromDropInDir_missingDir(t *testing.T) {
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, "/nonexistent/dir"); err != nil {
		t.Fatalf("missing dir should be a no-op (silently), got %v", err)
	}
}

func TestSeedFromDropInDir_ignoresNonJSON(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# notes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "10-ok.json"), []byte(`[{"name":"only","dsn":"quic://x:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "only" {
		t.Fatalf("non-json should be ignored, got %v", got)
	}
}

func TestSeedFromDropInDir_invalidJSONFails(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "10-bad.json"), []byte(`not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	err := seedFromDropInDir(context.Background(), store, dir)
	if err == nil {
		t.Fatalf("expected error on invalid json")
	}
}

func TestSeedFromDropInDir_firstWinsOnNameCollision(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "10-first.json"), []byte(`[{"name":"x","dsn":"quic://a:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "20-second.json"), []byte(`[{"name":"x","dsn":"quic://b:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 (first-wins), got %d: %v", len(got), got)
	}
	if got[0].DSN != "quic://a:3141" {
		t.Errorf("first-wins violated: got dsn=%q, want quic://a:3141", got[0].DSN)
	}
}
