package main

import (
	"log/slog"
	"net/http"

	genapi "geodedb.com/geode-ui/gen/api"
	genmcp "geodedb.com/geode-ui/gen/mcp"
	"geodedb.com/geode-ui/gen/pkg/mcpx"
	genws "geodedb.com/geode-ui/gen/ws"
	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/server"
	"geodedb.com/geode-ui/internal/ui"
)

// app_routes.go decomposes the routing body of newApp per QUALITY rank
// 3 / #193. See app_issuer.go for the full split map.

// registerRoutes wires every HTTP route the geode-ui server serves
// onto mux. Layered:
//
//	REST    — genapi-emitted /api/v1/*
//	logout  — POST /api/v1/auth/logout (hand-rolled; SEC-F7 + SEC-NEW-9)
//	csrf    — GET  /api/v1/csrf       (hand-rolled; SEC-F7 S3b)
//	WS      — genws-emitted /ws/* (separate server type; same Issuer)
//	lsp     — /ws/lsp upstream-LSP bridge (conditional on cfg.lspEnabled)
//	mcp     — POST /mcp (genmcp JSON-RPC envelope; SEC-F1 + F-AUTH-1)
//	spa     — / catch-all with CSP/COOP (WithSPASecurityHeaders)
//
// Returns the *GraphServer because the rate-limiter assembly (in
// app_limiters.go) needs the Issuer wired into the limiter config; the
// Issuer itself is the one newApp built.
func registerRoutes(mux *http.ServeMux, cfg appConfig, pool *conn.Pool, issuer *jwt.Issuer, srvCfg server.Config) (*server.GraphServer, error) {
	srv := server.New(srvCfg)
	genapi.RegisterGeneratedAPI(mux, srv, genapi.APIOptions{
		AuthJWT:     srv.AuthJWT,
		GlobalRate:  2000,
		GlobalBurst: 400,
	})

	// SEC-F7 (#62): hand-rolled logout — clears the geode-ui-auth
	// cookie and returns 204. Anonymous-allowed so a client that has
	// lost its token (cleared cookies, expired JWT) can still ask the
	// server to clear any stale cookie that may remain. SEC-NEW-9
	// (#205) extends this with best-effort JTI revocation; see
	// internal/server/handlers_auth.go:HandleLogout.
	mux.HandleFunc("POST /api/v1/auth/logout", srv.HandleLogout)

	// SEC-F7 (#62 S3b): CSRF token endpoint. GET issues a fresh token
	// in both a NON-HttpOnly cookie (for SPA reading) and the JSON
	// response body. The double-submit middleware enforces a matching
	// X-CSRF-Token header on cookie-authenticated state-changing
	// requests.
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

	// /ws/lsp WebSocket-to-TCP bridge to the upstream LSP listener
	// (geode serve --lsp-port). Conditional on cfg.lspEnabled so
	// deployments that don't expose LSP through the browser-facing
	// surface can opt out with -lsp-enabled=false.
	if cfg.lspEnabled {
		server.RegisterLspWS(mux, srv.AuthJWT, cfg.lspUpstreamAddr)
		slog.Info("lsp bridge registered", "upstream", cfg.lspUpstreamAddr)
	}

	// MCP surface — geode.json declares one tool ("query") on the http
	// transport. genmcp.Register populates the package-level
	// MCPHandler / MCPSTDIOFunc; we expose the HTTP handler at /mcp so
	// MCP clients can reach the JSON-RPC envelope. The tool delegates
	// straight to GraphServer.handleQuery so HTTP and MCP callers see
	// identical query semantics, validation, and timeout handling.
	//
	// SEC-F1 (#69): wire the same JWT verifier the API surface uses so
	// /mcp authorizes requests instead of fail-closing on every call.
	// F-AUTH-1 (#132): mcpx now threads context.Context through
	// MCPServerInterface.Query, and the auth verifier returns the
	// request-scoped context.
	genmcp.Register(server.NewMCPServer(srv))
	mcpx.SetAuthVerifier(srv.MCPAuthVerifier)
	mux.Handle("/mcp", http.HandlerFunc(genmcp.HandleMCPHTTP))

	uiHandler, err := ui.Handler()
	if err != nil {
		return nil, err
	}
	// Wrap only the SPA path with CSP + COOP — those headers protect the
	// HTML document the browser renders (Monaco, styled-components,
	// frame-ancestors lockdown) and would just bloat every JSON response
	// if applied globally. The structural fix belongs in genapi's
	// httpx.WrapHandler alongside HSTS and X-Frame-Options; until that
	// lands the SPA wrapper is the safe, minimal mitigation for SEC-F4.
	mux.Handle("/", server.WithSPASecurityHeaders(uiHandler))

	return srv, nil
}
