package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// seedFromDropInDir reads every *.json file in `dir` in
// lexicographic-by-filename order and seeds each entry into `store` as
// scope=system, the same shape as the legacy -profiles JSON flag.
//
// Semantics:
//   - Missing dir → silent no-op (the package's seed-profiles.d may
//     legitimately not exist on a manual binary install).
//   - Non-empty store → silent no-op (matches seedFromJSON: drop-ins
//     only seed an empty store).
//   - Non-*.json files → ignored (README.md, swp files, dotfiles).
//   - Invalid JSON → loud error (operator misconfiguration; the unit
//     fails to start, which is what the operator wants — a half-
//     seeded store hides the bug).
//   - Duplicate profile name across files → first-wins (lex-earlier
//     file's entry is kept; later collisions are dropped with a debug
//     log line).
//
// The 10-, 20-, 99- prefix convention matches systemd / udev / cron
// drop-in directories. Operators add a higher-prefix file to override
// a default; first-wins on the NAME makes that scheme deterministic.
func seedFromDropInDir(ctx context.Context, store profilestore.Store, dir string) error {
	existing, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("readdir %q: %w", dir, err)
	}

	files := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		files = append(files, e.Name())
	}
	sort.Strings(files)

	seen := make(map[string]struct{}, 8)
	for _, fname := range files {
		path := filepath.Join(dir, fname)
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %q: %w", path, err)
		}
		var batch []conn.Profile
		if err := json.Unmarshal(raw, &batch); err != nil {
			return fmt.Errorf("parse %q: %w", path, err)
		}
		for _, p := range batch {
			if _, dup := seen[p.Name]; dup {
				continue
			}
			seen[p.Name] = struct{}{}
			p.Scope = conn.ProfileScopeSystem
			p.OwnerUserID = ""
			if err := loadTLSFiles(&p); err != nil {
				return fmt.Errorf("load tls for %q in %q: %w", p.Name, path, err)
			}
			if _, err := store.Put(ctx, p); err != nil {
				return fmt.Errorf("seed %q from %q: %w", p.Name, path, err)
			}
		}
	}
	return nil
}
