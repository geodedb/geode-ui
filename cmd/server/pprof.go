package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"time"
)

// PERF-N3 (#278): debug pprof endpoints.
//
// `net/http/pprof` is intentionally NOT imported by `cmd/server/app.go`,
// so the production main listener does not expose `/debug/pprof/*`. Perf
// debugging in production requires a fresh build with the import added,
// which is operationally awkward.
//
// This file plumbs an OPT-IN pprof endpoint:
//
//   - off by default (env var GEODE_PPROF unset or != "1").
//   - when set, binds a SEPARATE http.Server to 127.0.0.1:6060 (default;
//     overridable via GEODE_PPROF_LISTEN). The address MUST be a
//     loopback-only host — the helper validates this and refuses any
//     other interface (0.0.0.0 / public IP / unix socket) to keep the
//     pprof endpoint off the network even if an operator misconfigures
//     it.
//   - the pprof endpoints (/debug/pprof/, /debug/pprof/profile, etc.)
//     are mounted on a dedicated *http.ServeMux. They are NOT plumbed
//     into the main listener's mux, so they cannot leak via the
//     production routes.
//
// On shutdown the helper Close()s the listener and waits up to 5s for
// the server to drain in-flight pprof captures (a CPU profile can
// legitimately run for the full /profile?seconds=30 window).

const (
	// defaultPprofListen is the canonical loopback-only address. An
	// operator can override with GEODE_PPROF_LISTEN as long as the
	// override resolves to a loopback host (validated below).
	defaultPprofListen = "127.0.0.1:6060"

	pprofShutdownBudget = 5 * time.Second
)

// isLoopbackAddr returns true when addr is a syntactically-valid
// host:port whose host portion is 127.0.0.1, [::1], or "localhost".
// Any other host (including 0.0.0.0, public IPs, or empty host) is
// rejected so a misconfiguration cannot accidentally expose pprof.
func isLoopbackAddr(addr string) bool {
	// Use net.SplitHostPort via http's parser indirectly: a host:port
	// without a port is also rejected. ParseAddr would accept a bare
	// host; net.SplitHostPort is the stdlib-canonical way.
	// We do not import "net" purely for this check because the rest of
	// the file uses net/http; manual split is sufficient.
	// Accept the documented forms only:
	switch {
	case addr == "":
		return false
	case len(addr) > 2 && addr[0] == '[':
		// IPv6 literal: must be [::1]:N — refuse any other.
		// Simple prefix check is safe because [::1] is the only
		// loopback IPv6 we accept.
		return startsWith(addr, "[::1]:")
	default:
		// IPv4 / hostname: accept 127.0.0.1:N or localhost:N.
		return startsWith(addr, "127.0.0.1:") || startsWith(addr, "localhost:")
	}
}

func startsWith(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}

// newPprofMux returns a fresh http.ServeMux pre-loaded with the
// canonical pprof endpoints. It is exported (lowercase intra-package
// because tests live in `package main`) so the smoke test can mount
// the same mux without spinning up a real listener.
func newPprofMux() *http.ServeMux {
	mux := http.NewServeMux()
	// `net/http/pprof` registers its handlers on http.DefaultServeMux
	// by side-effect of import. We register the exported handlers
	// onto our private mux explicitly so the default mux is left
	// untouched (a clean main listener stays clean).
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	return mux
}

// startPprofServer reads GEODE_PPROF / GEODE_PPROF_LISTEN from getenv
// and, if enabled, starts the pprof server in a goroutine. The
// returned shutdown closure blocks for up to pprofShutdownBudget; the
// caller wires it into the main shutdown sequence. Returns nil
// closures + nil error when the feature is disabled (the common
// production path).
func startPprofServer(getenv func(string) string) (shutdown func(context.Context) error, err error) {
	if getenv("GEODE_PPROF") != "1" {
		return func(context.Context) error { return nil }, nil
	}
	addr := getenv("GEODE_PPROF_LISTEN")
	if addr == "" {
		addr = defaultPprofListen
	}
	if !isLoopbackAddr(addr) {
		return nil, fmt.Errorf(
			"pprof: refusing non-loopback listen address %q "+
				"(allowed: 127.0.0.1:N, [::1]:N, localhost:N)", addr,
		)
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           newPprofMux(),
		ReadHeaderTimeout: 5 * time.Second,
		// WriteTimeout=0 intentional: /debug/pprof/profile?seconds=30
		// legitimately runs for the full window. The server is
		// loopback-only so the slow-read DoS surface is the operator
		// themself.
	}
	go func() {
		slog.Info("pprof: serving", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("pprof: listener failed", "err", err)
		}
	}()
	return func(ctx context.Context) error {
		shutdownCtx, cancel := context.WithTimeout(ctx, pprofShutdownBudget)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}, nil
}
