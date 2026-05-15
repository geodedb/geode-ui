package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// wsExemptTimeoutHandler wraps next with an http.TimeoutHandler that
// caps every request at restTimeout — EXCEPT requests whose path starts
// with "/ws/", which reach next directly. The WS surface streams query
// results for as long as the query runs (potentially minutes for a
// large MATCH), and http.TimeoutHandler both buffers the whole response
// and refuses to expose http.Hijacker — either of which breaks a
// streaming WebSocket. Per-frame deadlines (wsx.Conn, configured by
// gen/ws/ws_handlers.gen.go) plus context cancellation handle a stuck
// WS peer instead. PERF-F12 / #56.
func wsExemptTimeoutHandler(next http.Handler, restTimeout time.Duration) http.Handler {
	restTimed := http.TimeoutHandler(next, restTimeout, "request timed out")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/ws/") {
			next.ServeHTTP(w, r)
			return
		}
		restTimed.ServeHTTP(w, r)
	})
}

// seedFromJSON populates an empty store with the supplied profiles as
// scope=system. PEM material is read from the legacy file paths if
// present so existing deployments migrate cleanly. A non-empty store
// is left untouched.
func seedFromJSON(ctx context.Context, store profilestore.Store, profiles []conn.Profile) error {
	existing, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}
	for _, p := range profiles {
		p.Scope = conn.ProfileScopeSystem
		p.OwnerUserID = ""
		if err := loadTLSFiles(&p); err != nil {
			return fmt.Errorf("load tls for %q: %w", p.Name, err)
		}
		if _, err := store.Put(ctx, p); err != nil {
			return fmt.Errorf("seed %q: %w", p.Name, err)
		}
	}
	return nil
}

// loadTLSFiles reads the legacy file-path TLS fields off Profile and
// populates the corresponding TLS PEM strings. Empty file paths are
// left alone. Already-populated PEM strings (e.g., a profile loaded
// from the store) take precedence.
func loadTLSFiles(p *conn.Profile) error {
	if p.TLSCAFile != "" && p.TLS.CAPEM == "" {
		b, err := os.ReadFile(p.TLSCAFile)
		if err != nil {
			return err
		}
		p.TLS.CAPEM = string(b)
	}
	if p.ClientCertFile != "" && p.TLS.ClientCertPEM == "" {
		b, err := os.ReadFile(p.ClientCertFile)
		if err != nil {
			return err
		}
		p.TLS.ClientCertPEM = string(b)
	}
	if p.ClientKeyFile != "" && p.TLS.ClientKeyPEM == "" {
		b, err := os.ReadFile(p.ClientKeyFile)
		if err != nil {
			return err
		}
		p.TLS.ClientKeyPEM = string(b)
	}
	return nil
}

// reloadPoolFromStore lists every profile from the store and applies
// the union as the pool's registered set. No-op when the store is
// empty.
func reloadPoolFromStore(ctx context.Context, store profilestore.Store, pool *conn.Pool) error {
	all, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return err
	}
	if len(all) == 0 {
		return nil
	}
	return pool.Reload(all)
}
