package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	genapi "geodedb.com/geode-ui/gen/api"
	genmcp "geodedb.com/geode-ui/gen/mcp"
	"geodedb.com/geode-ui/gen/pkg/httpx"
	"geodedb.com/geode-ui/gen/pkg/mcpx"
	"geodedb.com/geode-ui/gen/pkg/obsx"
	genws "geodedb.com/geode-ui/gen/ws"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/profilestore"
	"geodedb.com/geode-ui/internal/server"
	"geodedb.com/geode-ui/internal/ui"
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
	listen            string
	profilesFile      string
	profileStore      string
	secretHex         string
	jwtTTL            time.Duration
	adminUsers        string
	uploadDir         string
	secureCookies     bool
	passwordHIBPCheck bool
	profileCRUDRPS    float64
	profileCRUDBurst  float64
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
	fs.StringVar(&cfg.adminUsers, "admin-users", "geode", "comma-separated upstream usernames granted the 'admin' role on login (Geode v0.5.11 doesn't expose role enumeration on the wire yet)")
	fs.StringVar(&cfg.uploadDir, "upload-dir", "/var/lib/geode-ui/uploads", "filesystem directory where multipart uploads (backup files, migration content) are persisted; subdirectories backups/ and migrations/ are auto-created")
	fs.BoolVar(&cfg.secureCookies, "secure-cookies", true, "set the Secure attribute on auth + CSRF cookies (SEC-F7 / #62); disable only for local-dev over plain HTTP — production deployments MUST keep this true")
	fs.BoolVar(&cfg.passwordHIBPCheck, "password-hibp-check", false, "enable HIBP k-anonymity check on PostUsers/PatchUsername/Password (GAP-N4 / #72); off by default so password-set handlers stay hermetic and air-gap-friendly")
	// Per-actor profile-CRUD rate limit (GAP-S7 #120). Production default
	// is a deliberately tight 30 req/min (rps 0.5) / burst 10 — see
	// server.ProfileLimiterDefaults(). Tunable here so heavy automated
	// callers (e.g. the e2e suite, which drives profile CRUD across
	// several parallel browser workers sharing one JWT subject) can
	// loosen it without weakening the shipped default. <= 0 means "use
	// the built-in default".
	fs.Float64Var(&cfg.profileCRUDRPS, "profile-crud-rps", 0, "per-actor profile-CRUD rate (req/sec); <=0 uses the built-in default (0.5 = 30/min)")
	fs.Float64Var(&cfg.profileCRUDBurst, "profile-crud-burst", 0, "per-actor profile-CRUD burst size; <=0 uses the built-in default (10)")
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
}

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
func newApp(cfg appConfig, getenv func(string) string) (*app, error) {
	a := &app{cfg: cfg}
	// On error, unwind whatever we've opened so far.
	ok := false
	defer func() {
		if !ok {
			a.close()
		}
	}()

	if cfg.secretHex == "" {
		return nil, errors.New("missing -jwt-secret-hex (generate with `openssl rand -hex 32`)")
	}
	secret, err := hex.DecodeString(cfg.secretHex)
	if err != nil {
		return nil, fmt.Errorf("decode -jwt-secret-hex: %w", err)
	}
	issuer, err := jwt.NewIssuer(secret, cfg.jwtTTL)
	if err != nil {
		return nil, fmt.Errorf("jwt issuer: %w", err)
	}
	a.issuer = issuer

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

	// GAP-S5 (#118): the profile store holds DSN strings (with embedded
	// database passwords) and full TLS PEM material at rest. Encrypt
	// those four columns with AES-256-GCM. The key MUST be supplied via
	// GEODE_PROFILESTORE_KEY (base64-encoded 32 bytes) — fail-fast if
	// missing so we never silently fall back to plaintext-on-disk in a
	// production process. See internal/profilestore/crypto.go for the
	// wire format and the legacy-row migration path.
	cipher, err := profilestore.NewCipherFromEnvFunc(getenv, "GEODE_PROFILESTORE_KEY")
	if err != nil {
		return nil, fmt.Errorf("profile store encryption key: %w", err)
	}
	store, err := profilestore.OpenSQLiteEncrypted(cfg.profileStore, cipher)
	if err != nil {
		return nil, fmt.Errorf("profile store open: %w", err)
	}
	a.cleanups = append(a.cleanups, func() { _ = store.Close() })

	// First-launch seed: if the store has zero profiles AND a -profiles
	// JSON file was supplied, seed the store with the JSON contents as
	// scope=system. Subsequent launches respect whatever's in the store —
	// the JSON file becomes one-shot.
	if err := seedFromJSON(context.Background(), store, profiles); err != nil {
		return nil, fmt.Errorf("profile store seed: %w", err)
	}

	// Make the persisted set the source of truth for the in-memory pool.
	if err := reloadPoolFromStore(context.Background(), store, pool); err != nil {
		return nil, fmt.Errorf("profile pool reload: %w", err)
	}

	// SEC-N2 follow-up: make the JWT revocation set durable by backing it
	// with the profile-store SQLite file (a new revoked_jti /
	// password_changed_at table pair in the existing DB — NOT a second
	// file). AttachSQLiteRW runs the migrations, hydrates the in-memory
	// read-through cache from disk, and GCs stale rows. After this, a
	// token revoked before a restart stays revoked; the hot validation
	// path still reads the cache only and issues zero SQL per request.
	//
	// PERF-2026-05-11-09 (#150): we hand the revocation backend BOTH the
	// profile store's single-writer handle (DBHandle — used for the
	// migrations and the putJTI/putUser/sweep writes, so they serialise
	// with profile CRUD) AND its read-only handle (DBHandleRO — used for
	// the hydration SELECTs, so a revocation reload never queues behind
	// an in-flight profile-CRUD write; for ':memory:' both are the same
	// handle). This piggybacks on the profile store's *sql.DB pair — no
	// new flag. If the store backend isn't SQLite-file-backed (it always
	// is for the production constructor), fall back to in-memory-only.
	if dbp, ok := store.(profilestore.DBHandleProvider); ok {
		if err := issuer.Revocation().AttachSQLiteRW(dbp.DBHandle(), dbp.DBHandleRO()); err != nil {
			return nil, fmt.Errorf("jwt revocation store: %w", err)
		}
	} else {
		slog.Warn("profile store backend does not expose a SQLite handle; JWT revocation state is in-memory only and will not survive a restart")
	}

	mux := http.NewServeMux()

	adminSet := map[string]bool{}
	for _, u := range strings.Split(cfg.adminUsers, ",") {
		if name := strings.TrimSpace(u); name != "" {
			adminSet[name] = true
		}
	}

	srv := server.New(server.Config{
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
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     srv.AuthJWT,
		GlobalRate:  2000,
		GlobalBurst: 400,
	})

	// GAP-Q5 (#34): the multipart upload endpoints
	// (POST /api/v1/backups/upload, POST /api/v1/migrations/upload) are
	// now declared in geode.json with a `"type": "file"` request schema
	// and emitted by genapi as proper typed routes — registered above by
	// genapi.RegisterGeneratedAPI, implemented as srv.BackupUpload /
	// srv.MigrationUpload in internal/server/handlers_uploads.go. The
	// generated wrapper does JWT auth + admin-role enforcement + the
	// 64 MiB body cap + multipart parsing; the SPA gets a typed
	// client.backupUpload / client.migrationUpload method that builds
	// the FormData. No hand-rolled mux.HandleFunc needed any more.

	// SEC-F7 (#62): hand-rolled logout — clears the geode-ui-auth
	// cookie and returns 204. Anonymous-allowed so a client that has
	// lost its token (cleared cookies, expired JWT) can still ask the
	// server to clear any stale cookie that may remain. Server-side
	// JWT revocation is out of scope for #62 — tracked separately as
	// SEC-N2.
	mux.HandleFunc("POST /api/v1/auth/logout", srv.HandleLogout)

	// SEC-F7 (#62 S3b): CSRF token endpoint. GET issues a fresh token
	// in both a NON-HttpOnly cookie (for SPA reading) and the JSON
	// response body. The double-submit middleware below enforces a
	// matching X-CSRF-Token header on cookie-authenticated state-
	// changing requests.
	mux.HandleFunc("/api/v1/csrf", srv.HandleCSRF)

	// /ws/* surface lives on a separate server type because the
	// generated WS interface emits "Query" for /ws/query, which would
	// collide with the API "Query" method on *GraphServer. Both
	// servers share the same Config and AuthJWT — the WS upgrade
	// can't carry an Authorization header from a browser, so AuthJWT
	// also accepts ?access_token= as a fallback (see auth.go).
	wsSrv := server.NewWSServer(server.Config{
		Version: "v0.1.0",
		Pool:    pool,
		JWT:     issuer,
	})
	genws.RegisterGeneratedWS(mux, wsSrv, genws.WSOptions{
		AuthJWT: srv.AuthJWT,
	})

	// MCP surface — geode.json declares one tool ("query") on the http
	// transport. genmcp.Register populates the package-level
	// MCPHandler / MCPSTDIOFunc; we expose the HTTP handler at /mcp so
	// MCP clients can reach the JSON-RPC envelope. The tool delegates
	// straight to GraphServer.handleQuery so HTTP and MCP callers see
	// identical query semantics, validation, and timeout handling.
	genmcp.Register(server.NewMCPServer(srv))
	// SEC-F1 (#69): wire the same JWT verifier the API surface uses so
	// /mcp authorizes requests instead of fail-closing on every call.
	// Without this the route returned 401 for every request because
	// authVerifier defaulted to nil, leaving the MCP envelope
	// unreachable to legitimate clients. AuthJWT enforces the same
	// HS256 lockdown + role context that the REST handlers see.
	//
	// F-AUTH-1 (#132): mcpx now threads context.Context through
	// MCPServerInterface.Query, and the auth verifier returns the
	// request-scoped context. srv.mcpAuthVerifier runs AuthJWT (which
	// enriches *r's context with the profile/roles/subject claims) and
	// hands that context to mcpx, which threads it straight into the
	// `query` tool body. The MCP `query` tool therefore runs against the
	// caller's JWT `profile` claim natively — no per-goroutine stash.
	mcpx.SetAuthVerifier(srv.MCPAuthVerifier)
	mux.Handle("/mcp", http.HandlerFunc(genmcp.HandleMCPHTTP))

	uiHandler, err := ui.Handler()
	if err != nil {
		return nil, fmt.Errorf("ui handler: %w", err)
	}
	// Wrap only the SPA path with CSP + COOP — those headers protect the
	// HTML document the browser renders (Monaco, styled-components,
	// frame-ancestors lockdown) and would just bloat every JSON response
	// if applied globally. The structural fix belongs in genapi's
	// httpx.WrapHandler alongside HSTS and X-Frame-Options; until that
	// lands the SPA wrapper is the safe, minimal mitigation for SEC-F4.
	mux.Handle("/", server.WithSPASecurityHeaders(uiHandler))

	// PERF-F12 (#56): the WS streaming surface (/ws/query) must NOT be
	// killed by a server-wide write timeout — a `MATCH (n) RETURN n` over
	// a large graph legitimately streams for minutes. So WriteTimeout is
	// deliberately NOT applied to the *http.Server below; instead the
	// non-WS (REST + SPA) surface is wrapped in an http.TimeoutHandler
	// with restWriteTimeout, and the /ws/ prefix routes around it. Two
	// independent cleanup mechanisms still cover a stuck WS peer:
	//   1. Per-frame deadlines: gen/ws/ws_handlers.gen.go configures
	//      wsx.Options{ReadTimeout, WriteTimeout: 30s} for every WS path,
	//      and wsx.Conn.{ReadMessage,WriteMessage} call
	//      SetReadDeadline/SetWriteDeadline before each frame — so a
	//      client that stops ACKing trips the deadline within 30s and
	//      the handler unwinds.
	//   2. Idle TCP timeout: httpSrv.IdleTimeout reaps a connection that
	//      is open but exchanging nothing.
	// hcfg.WriteTimeout/ReadTimeout are still listed here because
	// httpx.WrapHandler's signature takes the full Config, but WrapHandler
	// only consumes MaxBodyBytes + CORS + EnableCompression + PerIP* —
	// the timeouts are applied explicitly below where the WS exemption
	// can be expressed.
	hcfg := httpx.Config{
		ReadHeader:     5 * time.Second,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   restWriteTimeout,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 16384,
		MaxBodyBytes:   1 << 20,
		// PERF-F13 (#57): transparent gzip of text-ish JSON responses
		// >=1 KiB when the client sends Accept-Encoding: gzip. Skips
		// already-encoded responses, images/video/audio, and tiny
		// bodies; adds Vary: Accept-Encoding; pools writers at
		// BestSpeed. WS upgrades route around this anyway, and the
		// gzip wrapper passes Hijack through if they didn't.
		EnableCompression: true,
		// SEC-N7 (#66): coarse global per-IP token bucket applied to
		// EVERY route as an abuse ceiling underneath the tighter
		// per-route limiters (loginlimiter.go: 5 rps/IP on
		// /auth/login; profilelimiter.go: 30 req/min per JWT subject
		// on profile CRUD). 50 rps / burst 100 per IP is generous
		// enough that legitimate SPA traffic never trips it but a
		// scripted flood from one source is throttled. Keyed on
		// RemoteAddr — this server is not behind a trusted proxy that
		// rewrites X-Forwarded-For, so the proxy-header sources would
		// be forgeable.
		PerIPRPS:    50,
		PerIPBurst:  100,
		PerIPSource: httpx.IPSourceRemoteAddr,
	}
	// Per-IP / per-(profile, username) login limiter (SEC-F2 #58, SEC-N7
	// #66). Mounted around the mux so it observes /api/v1/auth/login
	// before the genapi-emitted route handler runs. The structural fix
	// belongs in genapi (per-IP partitioning in gen/pkg/httpx); a
	// follow-up issue is filed.
	loginLimiter := server.NewLoginLimiter(server.LoginLimiterDefaults())
	limited := server.WrapLoginLimit(loginLimiter, mux)
	// Per-actor (JWT subject) profile-CRUD limiter (GAP-S7 #120).
	// Wraps the post-login chain so authenticated POST/PATCH/DELETE on
	// /api/v1/profiles routes share a 30-req/min ceiling per JWT
	// subject. Unauthenticated callers fall back to a per-IP bucket
	// (the genapi middleware will 401 them anyway, but the IP bucket
	// stops a flood of malformed POSTs from being free).
	profileLimiterCfg := server.ProfileLimiterDefaults()
	profileLimiterCfg.JWT = issuer
	if cfg.profileCRUDRPS > 0 {
		profileLimiterCfg.PerActorRate = cfg.profileCRUDRPS
	}
	if cfg.profileCRUDBurst > 0 {
		profileLimiterCfg.PerActorBurst = cfg.profileCRUDBurst
	}
	profileLimiter := server.NewProfileLimiter(profileLimiterCfg)
	limited = server.WrapProfileLimit(profileLimiter, limited)
	// SEC-F7 (#62 S3b): CSRF double-submit middleware. Inspects the
	// raw request's auth cookie to decide whether to enforce — runs
	// upstream of AuthJWT but the path-exempt + method-safe guards
	// handle the boundaries. Bearer-authenticated and unauthenticated
	// requests pass through.
	csrfWrapped := server.CSRFMiddleware(limited)
	// Permissions-Policy is harmless and short enough to apply to every
	// response; wrap the entire pipeline so SPA, API, WS upgrade, MCP
	// endpoints all carry the directive. SEC-F5 (#71) deprecation
	// headers ride on the same wrap chain so any ?access_token=
	// request — header-, cookie-, or query-authed — gets the Sunset
	// signal in its response.
	handler := server.WithPermissionsPolicy(
		server.WithAccessTokenDeprecation(httpx.WrapHandler(hcfg, csrfWrapped)),
	)

	// PERF-F12 (#56): cap REST + SPA responses at restWriteTimeout, but
	// route WebSocket upgrades around the timeout handler. http.TimeoutHandler
	// buffers the whole response and does not implement http.Hijacker —
	// either of which would break a streaming WS connection (the upgrade
	// hijacks the conn and then streams indefinitely). The /ws/ prefix
	// therefore reaches `handler` directly; everything else goes through
	// the timeout-wrapped copy. Both branches dispatch into the same
	// middleware chain + mux, so routing is unchanged — only the timeout
	// envelope differs.
	rootHandler := wsExemptTimeoutHandler(handler, restWriteTimeout)
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
		// via the http.TimeoutHandler above (which the /ws/ prefix is
		// routed around). See the PERF-F12 comment block above.
	}

	ok = true
	return a, nil
}

// serve runs the listener and blocks until ctx is cancelled, then
// gracefully drains in-flight requests (5s budget). Returns the first
// fatal listener error, or any error from Shutdown — distinct from the
// silent shutdown of the old main (Q38 / #180).
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
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.httpSrv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
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
		slog.Error("serve", "err", err)
		obsx.FlushLogs()
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
