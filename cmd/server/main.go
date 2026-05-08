package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
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
	"geodedb.com/geode-ui/internal/server"
	"geodedb.com/geode-ui/internal/ui"
)

func main() {
	var (
		listen        string
		profilesFile  string
		secretHex     string
		jwtTTL        time.Duration
		adminUsers    string
		uploadDir     string
		secureCookies bool
	)
	flag.StringVar(&listen, "listen", ":8080", "address to listen on")
	flag.StringVar(&profilesFile, "profiles", "", "path to JSON profiles config")
	flag.StringVar(&secretHex, "jwt-secret-hex", "", "hex-encoded HS256 secret (>=32 bytes); generate with `openssl rand -hex 32`")
	flag.DurationVar(&jwtTTL, "jwt-ttl", 8*time.Hour, "JWT TTL (1m..24h)")
	flag.StringVar(&adminUsers, "admin-users", "geode", "comma-separated upstream usernames granted the 'admin' role on login (Geode v0.5.11 doesn't expose role enumeration on the wire yet)")
	flag.StringVar(&uploadDir, "upload-dir", "/var/lib/geode-ui/uploads", "filesystem directory where multipart uploads (backup files, migration content) are persisted; subdirectories backups/ and migrations/ are auto-created")
	flag.BoolVar(&secureCookies, "secure-cookies", true, "set the Secure attribute on auth + CSRF cookies (SEC-F7 / #62); disable only for local-dev over plain HTTP — production deployments MUST keep this true")
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
	})
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     srv.AuthJWT,
		GlobalRate:  2000,
		GlobalBurst: 400,
	})

	// Hand-rolled multipart upload endpoints — outside genapi because
	// genapi's request-validator pipeline is JSON-only; multipart is
	// the natural shape for "upload a backup or migration file".
	//
	// IMPORTANT: the method prefix is mandatory. Go 1.22+ ServeMux
	// detects a conflict with the genapi-emitted `DELETE /api/v1/backups/{file}`
	// (and similar for migrations) because a method-less pattern like
	// `/api/v1/backups/upload` is "more specific" but matches more
	// methods than `DELETE …/{file}`, which makes it ambiguous which
	// route should win on a DELETE to /api/v1/backups/upload. Pinning
	// the upload routes to POST removes the ambiguity.
	mux.HandleFunc("POST /api/v1/backups/upload", srv.HandleBackupUpload)
	mux.HandleFunc("POST /api/v1/migrations/upload", srv.HandleMigrationUpload)

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

	hcfg := httpx.Config{
		ReadHeader:     5 * time.Second,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   60 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 16384,
		MaxBodyBytes:   1 << 20,
	}
	// Per-IP / per-(profile, username) login limiter (SEC-F2 #58, SEC-N7
	// #66). Mounted around the mux so it observes /api/v1/auth/login
	// before the genapi-emitted route handler runs. The structural fix
	// belongs in genapi (per-IP partitioning in gen/pkg/httpx); a
	// follow-up issue is filed.
	loginLimiter := server.NewLoginLimiter(server.LoginLimiterDefaults())
	limited := server.WrapLoginLimit(loginLimiter, mux)
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

	httpSrv := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
