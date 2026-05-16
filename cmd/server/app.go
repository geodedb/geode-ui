package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"geodedb.com/geode-ui/gen/pkg/obsx"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/profilestore"
	"geodedb.com/geode-ui/internal/server"
)

// defaultJWTTTL is the out-of-the-box JWT lifetime — kept as a named
// constant so bootstrap tests can build an appConfig without re-deriving
// the flag default.
const defaultJWTTTL = 8 * time.Hour

// restWriteTimeout caps every REST + SPA response. The /ws/ surface is
// routed around this (PERF-F12 / #56) — a streaming query legitimately
// runs for minutes.
const restWriteTimeout = 60 * time.Second

// appConfig is the fully-parsed startup configuration: everything the
// dependency graph needs that came off a flag or has a fixed default.
// Environment-derived secrets (GEODE_PROFILESTORE_KEY) are NOT held here
// — newApp pulls those from its getenv argument so the value never sits
// in a struct that might get logged.
type appConfig struct {
	listen               string
	profilesFile         string
	profileStore         string
	secretHex            string
	jwtTTL               time.Duration
	adminUsers           string
	uploadDir            string
	secureCookies        bool
	passwordHIBPCheck    bool
	profileCRUDRPS       float64
	profileCRUDBurst     float64
	trustProxyXFF        bool
	profileRewrapFromB64 string
	// LSP bridge wiring (geode-ui platform LSP integration). The
	// /ws/lsp WebSocket reverse-proxies to an upstream LSP TCP listener
	// (geode serve --lsp-port). lspEnabled gates route registration so
	// deployments that don't expose LSP through the browser-facing
	// surface can opt out with -lsp-enabled=false.
	lspUpstreamAddr string
	lspEnabled      bool
}

// parseFlags builds an appConfig from args[1:] using a private FlagSet
// (not flag.CommandLine) so run can be invoked repeatedly from tests.
// Returns flag.ErrHelp when -h/-help was requested (the caller should
// exit 0 in that case) or a parse error.
func parseFlags(args []string, output io.Writer) (appConfig, error) {
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	fs.SetOutput(output)
	var cfg appConfig
	fs.StringVar(&cfg.listen, "listen", ":8080", "address to listen on")
	fs.StringVar(&cfg.profilesFile, "profiles", "", "path to JSON profiles config; on first launch with -profile-store empty, seeds the store as scope=system profiles, then is unused")
	fs.StringVar(&cfg.profileStore, "profile-store", "/var/lib/geode-ui/profiles.db", "path to the SQLite profile store; profiles can be CRUD'd at runtime via /api/v1/profiles. ':memory:' for ephemeral test runs")
	fs.StringVar(&cfg.secretHex, "jwt-secret-hex", "", "hex-encoded HS256 secret (>=32 bytes); generate with `openssl rand -hex 32`")
	fs.DurationVar(&cfg.jwtTTL, "jwt-ttl", defaultJWTTTL, "JWT TTL (1m..24h)")
	// SEC-NEW-2 (#202): default is empty — no usernames are auto-granted
	// the 'admin' role unless the operator opts in explicitly. The previous
	// hard-coded "geode" default silently bootstrapped an admin account on
	// every fresh install, which is a privilege-escalation footgun in any
	// deployment that didn't already know about it. Operators that want the
	// old behaviour pass `-admin-users=geode` (or whatever set they need)
	// at startup; the audit event below records what was bootstrapped (or
	// not) for forensic review.
	//
	// BREAKING CHANGE: deployments that relied on the old "geode" default
	// must add `-admin-users=geode` (or equivalent) to their startup args.
	// See docs/RELEASE.md for the migration note.
	fs.StringVar(&cfg.adminUsers, "admin-users", "", "comma-separated upstream usernames granted the 'admin' role on login (default: empty — no admin auto-bootstrap; pass e.g. -admin-users=geode to opt in). Geode v0.5.11 doesn't expose role enumeration on the wire yet.")
	fs.StringVar(&cfg.uploadDir, "upload-dir", "/var/lib/geode-ui/uploads", "filesystem directory where multipart uploads (backup files, migration content) are persisted; subdirectories backups/ and migrations/ are auto-created")
	fs.BoolVar(&cfg.secureCookies, "secure-cookies", true, "set the Secure attribute on auth + CSRF cookies (SEC-F7 / #62); disable only for local-dev over plain HTTP — production deployments MUST keep this true")
	fs.BoolVar(&cfg.passwordHIBPCheck, "password-hibp-check", false, "enable HIBP k-anonymity check on PostUsers/PatchUsername/Password (GAP-N4 / #72); off by default so password-set handlers stay hermetic and air-gap-friendly")
	// SEC-NEW-8 (#211): one-shot startup sweep that re-seals every
	// encrypted profile-store column under the active
	// GEODE_PROFILESTORE_KEY after decrypting with the supplied
	// LEGACY key (base64-encoded 32 bytes, same shape as the env
	// var). Runs once after the store opens; the server then proceeds
	// to listen normally. Operators rotate the key by:
	//   1. snapshot the .db file
	//   2. swap GEODE_PROFILESTORE_KEY to the new key
	//   3. start the server once with -profilestore-rewrap-from <old>
	//   4. confirm the startup log shows non-zero RowsTouched and zero
	//      SkippedPlaintext
	//   5. drop the flag on subsequent startups
	// See docs/OPERATIONS.md#profile-store-key-rotation.
	fs.StringVar(&cfg.profileRewrapFromB64, "profilestore-rewrap-from", "", "one-shot startup sweep: base64-encoded LEGACY 32-byte AES-256 key (see docs/OPERATIONS.md#profile-store-key-rotation); empty disables the sweep")
	// Per-actor profile-CRUD rate limit (GAP-S7 #120). Production default
	// is a deliberately tight 30 req/min (rps 0.5) / burst 10 — see
	// server.ProfileLimiterDefaults(). Tunable here so heavy automated
	// callers (e.g. the e2e suite, which drives profile CRUD across
	// several parallel browser workers sharing one JWT subject) can
	// loosen it without weakening the shipped default. <= 0 means "use
	// the built-in default".
	fs.Float64Var(&cfg.profileCRUDRPS, "profile-crud-rps", 0, "per-actor profile-CRUD rate (req/sec); <=0 uses the built-in default (0.5 = 30/min)")
	fs.Float64Var(&cfg.profileCRUDBurst, "profile-crud-burst", 0, "per-actor profile-CRUD burst size; <=0 uses the built-in default (10)")
	// S-NEW-5 (#201): X-Forwarded-For is no longer trusted by default.
	// When this flag is false (the secure-by-default), the per-IP login
	// limiter (5 rps) and the per-(profile,username) lockout counter
	// key on RemoteAddr's host portion, so an attacker cannot rotate
	// the limiter key on every request or trip lockouts against
	// arbitrary innocent IPs (DoS-by-lockout). Enable only when the
	// binary sits behind a TLS-terminating reverse proxy you control
	// and that proxy strips/normalises any inbound XFF header.
	fs.BoolVar(&cfg.trustProxyXFF, "trust-proxy-xff", false, "trust X-Forwarded-For header for per-IP rate limiting (enable only when behind a TLS-terminating reverse proxy you control)")
	// /ws/lsp bridge wiring. The upstream defaults to 127.0.0.1:3142 to
	// match `geode serve --lsp-port=3142` colocation. Enabled by default
	// so a clean local boot of both binaries gives the browser editor
	// schema-aware completion out of the box.
	fs.StringVar(&cfg.lspUpstreamAddr, "lsp-upstream", "127.0.0.1:3142", "host:port of the upstream LSP TCP listener (geode serve --lsp-port)")
	fs.BoolVar(&cfg.lspEnabled, "lsp-enabled", true, "register the /ws/lsp WebSocket bridge to the upstream LSP listener")
	if err := fs.Parse(args[1:]); err != nil {
		return appConfig{}, err
	}
	return cfg, nil
}

// app is the constructed-but-not-yet-listening server: the assembled
// http.Handler, the *http.Server it will run on, and the cleanup funcs
// (pool + store close) registered during construction.
type app struct {
	cfg      appConfig
	handler  http.Handler
	httpSrv  *http.Server
	issuer   *jwt.Issuer
	cleanups []func()
	// shutdownBudget is how long serve() waits for in-flight requests to
	// drain on ctx-cancel before forcing the close. Defaults to
	// defaultShutdownBudget; tests lower it to keep the graceful-shutdown
	// path fast to exercise.
	shutdownBudget time.Duration
}

// defaultShutdownBudget is the graceful-drain window serve() gives
// in-flight requests on shutdown.
const defaultShutdownBudget = 5 * time.Second

// close runs the registered cleanup funcs in reverse registration order
// (LIFO, like deferred closes in the original main).
func (a *app) close() {
	for i := len(a.cleanups) - 1; i >= 0; i-- {
		a.cleanups[i]()
	}
}

// newApp builds the full dependency graph — profilestore + cipher, JWT
// issuer + durable revocation, connection pool seed, *server.GraphServer
// and the generated REST/MCP/WS surfaces, and the assembled middleware
// chain — and returns it WITHOUT starting the listener. getenv supplies
// the process environment (GEODE_PROFILESTORE_KEY). On any fatal-init
// failure it returns an error and runs no cleanup is left dangling: any
// resource opened before the failure is closed before returning.
//
// newApp is intentionally an orchestrator — the heavy lifting lives in
// app_issuer.go (JWT keys + profile-store cipher + rewrap sweep),
// app_limiters.go (login + profile-CRUD limiter assembly),
// app_csrf.go (httpx config + middleware chain), and app_routes.go
// (REST / WS / MCP / SPA route registration). See app_issuer.go for
// the full split map (QUALITY rank 3 / #193).
func newApp(cfg appConfig, getenv func(string) string) (*app, error) {
	a := &app{cfg: cfg, shutdownBudget: defaultShutdownBudget}
	// On error, unwind whatever we've opened so far.
	ok := false
	defer func() {
		if !ok {
			a.close()
		}
	}()

	// (1) JWT issuer + keys (SEC-NEW-7).
	issuer, err := buildIssuer(cfg, getenv)
	if err != nil {
		return nil, err
	}
	a.issuer = issuer

	// (2) Bootstrap profiles → pool.
	profiles := []conn.Profile{{Name: "default", DSN: "quic://127.0.0.1:3141"}}
	if cfg.profilesFile != "" {
		raw, err := os.ReadFile(cfg.profilesFile)
		if err != nil {
			return nil, fmt.Errorf("read profiles: %w", err)
		}
		if err := json.Unmarshal(raw, &profiles); err != nil {
			return nil, fmt.Errorf("parse profiles: %w", err)
		}
	}
	pool, err := conn.NewPool(profiles)
	if err != nil {
		return nil, fmt.Errorf("conn pool: %w", err)
	}
	a.cleanups = append(a.cleanups, func() { _ = pool.Close() })

	// (3) Profile store (GAP-S5 / #118 encryption).
	cipher, err := profilestore.NewCipherFromEnvFunc(getenv, "GEODE_PROFILESTORE_KEY")
	if err != nil {
		return nil, fmt.Errorf("profile store encryption key: %w", err)
	}
	store, err := profilestore.OpenSQLiteEncrypted(cfg.profileStore, cipher)
	if err != nil {
		return nil, fmt.Errorf("profile store open: %w", err)
	}
	a.cleanups = append(a.cleanups, func() { _ = store.Close() })

	// (4) SEC-NEW-8 (#211) one-shot rewrap sweep.
	if err := runProfileStoreRewrapIfRequested(cfg, store); err != nil {
		return nil, err
	}

	// (5) Seed + reload-from-store + revocation backend.
	if err := seedFromJSON(context.Background(), store, profiles); err != nil {
		return nil, fmt.Errorf("profile store seed: %w", err)
	}
	if err := reloadPoolFromStore(context.Background(), store, pool); err != nil {
		return nil, fmt.Errorf("profile pool reload: %w", err)
	}
	if dbp, ok := store.(profilestore.DBHandleProvider); ok {
		if err := issuer.Revocation().AttachSQLiteRW(dbp.DBHandle(), dbp.DBHandleRO()); err != nil {
			return nil, fmt.Errorf("jwt revocation store: %w", err)
		}
	} else {
		slog.Warn("profile store backend does not expose a SQLite handle; JWT revocation state is in-memory only and will not survive a restart")
	}

	// (6) Admin set + SEC-NEW-2 startup audit.
	adminSet, adminList := buildAdminSet(cfg.adminUsers)
	obsx.LogAudit("admin_bootstrap", map[string]any{
		"admin_count": len(adminList),
		"admin_users": adminList,
	})

	// (7) Routes (REST / WS / MCP / SPA).
	mux := http.NewServeMux()
	srv, err := registerRoutes(mux, cfg, pool, issuer, server.Config{
		Version:        "v0.1.0",
		Pool:           pool,
		Profiles:       pool,
		JWT:            issuer,
		TxStore:        server.NewTxStore(),
		AdminUsernames: adminSet,
		UploadDir:      cfg.uploadDir,
		SecureCookies:  cfg.secureCookies,
		Store:          store,
		PoolReloader:   pool,
		PasswordPolicy: server.PasswordPolicy{HIBPCheck: cfg.passwordHIBPCheck},
	})
	if err != nil {
		return nil, fmt.Errorf("register routes: %w", err)
	}
	_ = srv // srv is reachable via the registered handlers; keep ref for future hooks.

	// (8) Rate limiters → middleware chain.
	rateLimited := buildRateLimiters(cfg, issuer, mux)
	hcfg := httpxConfig()
	rootHandler := wrapMiddlewareChain(rateLimited, hcfg)

	a.handler = rootHandler
	a.httpSrv = &http.Server{
		Addr:    cfg.listen,
		Handler: rootHandler,
		// ReadHeaderTimeout guards against slowloris on the header read.
		ReadHeaderTimeout: 5 * time.Second,
		// IdleTimeout reaps idle keep-alive connections — including a WS
		// connection whose peer has gone silent without sending a close
		// frame (the per-frame deadlines in wsx handle the in-flight
		// case; this handles the "open but doing nothing" case).
		IdleTimeout: hcfg.IdleTimeout,
		// WriteTimeout is deliberately left at its zero value (no cap):
		// the /ws/ surface streams for as long as the query runs. The
		// REST surface's per-request cap is restWriteTimeout, applied
		// via the http.TimeoutHandler in wrapMiddlewareChain.
	}

	ok = true
	return a, nil
}

// buildAdminSet parses the -admin-users CSV into the set newApp hands
// to server.Config + the sorted slice the SEC-NEW-2 audit log emits.
func buildAdminSet(csv string) (map[string]bool, []string) {
	adminSet := map[string]bool{}
	for _, u := range strings.Split(csv, ",") {
		if name := strings.TrimSpace(u); name != "" {
			adminSet[name] = true
		}
	}
	adminList := make([]string, 0, len(adminSet))
	for name := range adminSet {
		adminList = append(adminList, name)
	}
	sort.Strings(adminList)
	return adminSet, adminList
}

// errGracefulShutdown wraps the (rare) error returned by
// http.Server.Shutdown when in-flight requests don't drain within the
// budget. run() uses errors.Is against it to log a WARN — a shutdown
// timeout means some connections were force-closed, which is operationally
// noteworthy but not a crash — versus an ERROR for a genuine fatal
// listener error. (Q38 / #180.)
var errGracefulShutdown = errors.New("graceful shutdown")

// serve runs the listener and blocks until ctx is cancelled, then
// gracefully drains in-flight requests (5s budget). Returns the first
// fatal listener error, or any error from Shutdown (wrapped in
// errGracefulShutdown) — distinct from the silent shutdown of the old
// main (Q38 / #180).
func (a *app) serve(ctx context.Context) error {
	// SEC-N2 (#64): periodically prune the in-memory JWT revocation set
	// so dead jti entries (past their token expiry) and stale
	// password-changed markers (older than the TTL ceiling, hence no
	// longer referenced by any still-valid token) don't accumulate. A
	// 10-minute cadence is plenty given the 1m..24h TTL window; the
	// maxTokenAge is the issuer's TTL so the sweep never drops a marker
	// a live token could still reference.
	a.issuer.Revocation().StartSweeper(ctx, 10*time.Minute, a.issuer.TTL())

	listenErr := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", a.cfg.listen)
		if err := a.httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
			return
		}
		listenErr <- nil
	}()
	select {
	case err := <-listenErr:
		return err
	case <-ctx.Done():
	}
	budget := a.shutdownBudget
	if budget <= 0 {
		budget = defaultShutdownBudget
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	if err := a.httpSrv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("%w: %w", errGracefulShutdown, err)
	}
	return nil
}

// run is the testable entry point: parse flags from args, build the app,
// serve it. Every fatal-init path returns a non-zero code with the error
// written to stderr (replacing the old os.Exit(1)/slog.Error pairs).
func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	cfg, err := parseFlags(args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		// flag already printed the error + usage to stderr.
		return 2
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(stdout, nil)))

	// PERF-2026-05-11-03 (#133): obsx buffers its JSON audit-log path; flush
	// on the way out so a graceful shutdown does not drop in-flight log
	// lines. The explicit FlushLogs() calls on the error paths below push a
	// buffered fatal line to the wire before the error text reaches stderr.
	defer obsx.FlushLogs()

	a, err := newApp(cfg, getenv)
	if err != nil {
		slog.Error("startup", "err", err)
		obsx.FlushLogs()
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	defer a.close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := a.serve(ctx); err != nil {
		// A graceful-shutdown timeout (some connections force-closed) is
		// noteworthy but not a crash — log it at WARN. A fatal listener
		// error stays ERROR. Either way it's surfaced to stderr with a
		// non-zero exit. (Q38 / #180.)
		if errors.Is(err, errGracefulShutdown) {
			slog.Warn("serve", "err", err)
		} else {
			slog.Error("serve", "err", err)
		}
		obsx.FlushLogs()
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
