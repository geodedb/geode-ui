package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
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
	genws "geodedb.com/geode-ui/gen/ws"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/profilestore"
	"geodedb.com/geode-ui/internal/server"
	"geodedb.com/geode-ui/internal/ui"
)

func main() {
	var (
		listen            string
		profilesFile      string
		profileStore      string
		secretHex         string
		jwtTTL            time.Duration
		adminUsers        string
		uploadDir         string
		secureCookies     bool
		passwordHIBPCheck bool
	)
	flag.StringVar(&listen, "listen", ":8080", "address to listen on")
	flag.StringVar(&profilesFile, "profiles", "", "path to JSON profiles config; on first launch with -profile-store empty, seeds the store as scope=system profiles, then is unused")
	flag.StringVar(&profileStore, "profile-store", "/var/lib/geode-ui/profiles.db", "path to the SQLite profile store; profiles can be CRUD'd at runtime via /api/v1/profiles. ':memory:' for ephemeral test runs")
	flag.StringVar(&secretHex, "jwt-secret-hex", "", "hex-encoded HS256 secret (>=32 bytes); generate with `openssl rand -hex 32`")
	flag.DurationVar(&jwtTTL, "jwt-ttl", 8*time.Hour, "JWT TTL (1m..24h)")
	flag.StringVar(&adminUsers, "admin-users", "geode", "comma-separated upstream usernames granted the 'admin' role on login (Geode v0.5.11 doesn't expose role enumeration on the wire yet)")
	flag.StringVar(&uploadDir, "upload-dir", "/var/lib/geode-ui/uploads", "filesystem directory where multipart uploads (backup files, migration content) are persisted; subdirectories backups/ and migrations/ are auto-created")
	flag.BoolVar(&secureCookies, "secure-cookies", true, "set the Secure attribute on auth + CSRF cookies (SEC-F7 / #62); disable only for local-dev over plain HTTP — production deployments MUST keep this true")
	flag.BoolVar(&passwordHIBPCheck, "password-hibp-check", false, "enable HIBP k-anonymity check on PostUsers/PatchUsername/Password (GAP-N4 / #72); off by default so password-set handlers stay hermetic and air-gap-friendly")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if secretHex == "" {
		slog.Error("missing -jwt-secret-hex (generate with `openssl rand -hex 32`)")
		os.Exit(1)
	}
	secret, err := hex.DecodeString(secretHex)
	if err != nil {
		slog.Error("decode -jwt-secret-hex", "err", err)
		os.Exit(1)
	}
	issuer, err := jwt.NewIssuer(secret, jwtTTL)
	if err != nil {
		slog.Error("jwt issuer", "err", err)
		os.Exit(1)
	}

	profiles := []conn.Profile{{Name: "default", DSN: "quic://127.0.0.1:3141"}}
	if profilesFile != "" {
		raw, err := os.ReadFile(profilesFile)
		if err != nil {
			slog.Error("read profiles", "err", err)
			os.Exit(1)
		}
		if err := json.Unmarshal(raw, &profiles); err != nil {
			slog.Error("parse profiles", "err", err)
			os.Exit(1)
		}
	}
	pool, err := conn.NewPool(profiles)
	if err != nil {
		slog.Error("conn pool", "err", err)
		os.Exit(1)
	}
	defer func() { _ = pool.Close() }()

	// GAP-S5 (#118): the profile store holds DSN strings (with embedded
	// database passwords) and full TLS PEM material at rest. Encrypt
	// those four columns with AES-256-GCM. The key MUST be supplied via
	// GEODE_PROFILESTORE_KEY (base64-encoded 32 bytes) — fail-fast if
	// missing so we never silently fall back to plaintext-on-disk in a
	// production process. See internal/profilestore/crypto.go for the
	// wire format and the legacy-row migration path.
	cipher, err := profilestore.NewCipherFromEnv("GEODE_PROFILESTORE_KEY")
	if err != nil {
		slog.Error("profile store encryption key", "err", err)
		os.Exit(1)
	}
	store, err := profilestore.OpenSQLiteEncrypted(profileStore, cipher)
	if err != nil {
		slog.Error("profile store open", "err", err)
		os.Exit(1)
	}
	defer func() { _ = store.Close() }()

	// First-launch seed: if the store has zero profiles AND a -profiles
	// JSON file was supplied, seed the store with the JSON contents as
	// scope=system. Subsequent launches respect whatever's in the store —
	// the JSON file becomes one-shot.
	if err := seedFromJSON(context.Background(), store, profiles); err != nil {
		slog.Error("profile store seed", "err", err)
		os.Exit(1)
	}

	// Make the persisted set the source of truth for the in-memory pool.
	if err := reloadPoolFromStore(context.Background(), store, pool); err != nil {
		slog.Error("profile pool reload", "err", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()

	adminSet := map[string]bool{}
	for _, u := range strings.Split(adminUsers, ",") {
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
		UploadDir:      uploadDir,
		SecureCookies:  secureCookies,
		Store:          store,
		PoolReloader:   pool,
		PasswordPolicy: server.PasswordPolicy{HIBPCheck: passwordHIBPCheck},
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
	mcpx.SetAuthVerifier(srv.AuthJWT)
	mux.HandleFunc("/mcp", genmcp.HandleMCPHTTP)

	uiHandler, err := ui.Handler()
	if err != nil {
		slog.Error("ui handler", "err", err)
		os.Exit(1)
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
	const restWriteTimeout = 60 * time.Second
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

	httpSrv := &http.Server{
		Addr:    listen,
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

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// SEC-N2 (#64): periodically prune the in-memory JWT revocation set
	// so dead jti entries (past their token expiry) and stale
	// password-changed markers (older than the TTL ceiling, hence no
	// longer referenced by any still-valid token) don't accumulate. A
	// 10-minute cadence is plenty given the 1m..24h TTL window; the
	// maxTokenAge is the issuer's TTL so the sweep never drops a marker
	// a live token could still reference.
	issuer.Revocation().StartSweeper(ctx, 10*time.Minute, issuer.TTL())

	go func() {
		slog.Info("listening", "addr", listen)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

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
