package main

import (
	"net/http"
	"time"

	"geodedb.com/geode-ui/gen/pkg/httpx"
	"geodedb.com/geode-ui/internal/server"
)

// app_csrf.go decomposes the middleware-chain body of newApp per
// QUALITY rank 3 / #193. See app_issuer.go for the full split map.

// httpxConfig returns the genapi httpx config used by the server.
// Hoisted out of newApp so the timeout, body-cap, gzip, and per-IP
// limiter knobs live in one focused, easily-auditable place.
func httpxConfig() httpx.Config {
	return httpx.Config{
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
}

// wrapMiddlewareChain layers the CSRF, gzip, header-policy, and
// timeout middleware around the rate-limited mux. Returns the
// outermost root handler newApp installs on the http.Server.
//
// Layer order, outer → inner:
//
//	wsExemptTimeoutHandler         (REST cap; WS routes around)
//	WithPermissionsPolicy          (global)
//	WithAccessTokenDeprecation     (global; SEC-NEW-6 counter + audit)
//	httpx.WrapHandler              (gzip + per-IP bucket + body cap)
//	CSRFMiddleware                 (double-submit on cookie auth)
//	rateLimited                    (login + profile-CRUD limiters)
//	mux                            (routes)
func wrapMiddlewareChain(rateLimited http.Handler, hcfg httpx.Config) http.Handler {
	// SEC-F7 (#62 S3b): CSRF double-submit middleware. Inspects the
	// raw request's auth cookie to decide whether to enforce — runs
	// upstream of AuthJWT but the path-exempt + method-safe guards
	// handle the boundaries. Bearer-authenticated and unauthenticated
	// requests pass through.
	csrfWrapped := server.CSRFMiddleware(rateLimited)
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
	// the timeout-wrapped copy.
	return wsExemptTimeoutHandler(handler, restWriteTimeout)
}
