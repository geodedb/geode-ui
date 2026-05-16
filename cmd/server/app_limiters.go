package main

import (
	"net/http"

	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/server"
)

// app_limiters.go decomposes the limiter-construction body of newApp
// per QUALITY rank 3 / #193. See app_issuer.go for the full split map.

// buildRateLimiters wires the per-IP login limiter (SEC-F2 #58 +
// SEC-N7 #66) and the per-(JWT-subject) profile-CRUD limiter (GAP-S7
// #120) around mux. Returns the wrapped handler that newApp later
// feeds into the CSRF + httpx middleware chain.
//
// Both limiters honor cfg.trustProxyXFF (SEC-NEW-5 / #201). The
// profile-CRUD limiter additionally consumes cfg.profileCRUDRPS and
// cfg.profileCRUDBurst as overrides for the shipped defaults (the
// e2e-suite raises both above the production default; <= 0 keeps the
// default).
func buildRateLimiters(cfg appConfig, issuer *jwt.Issuer, mux http.Handler) http.Handler {
	// Per-IP / per-(profile, username) login limiter (SEC-F2 #58, SEC-N7
	// #66). Mounted around the mux so it observes /api/v1/auth/login
	// before the genapi-emitted route handler runs. The structural fix
	// belongs in genapi (per-IP partitioning in gen/pkg/httpx); a
	// follow-up issue is filed.
	loginLimiterCfg := server.LoginLimiterDefaults()
	loginLimiterCfg.TrustProxyXFF = cfg.trustProxyXFF
	loginLimiter := server.NewLoginLimiter(loginLimiterCfg)
	limited := server.WrapLoginLimit(loginLimiter, mux)

	// Per-actor (JWT subject) profile-CRUD limiter (GAP-S7 #120).
	// Wraps the post-login chain so authenticated POST/PATCH/DELETE on
	// /api/v1/profiles routes share a 30-req/min ceiling per JWT
	// subject. Unauthenticated callers fall back to a per-IP bucket
	// (the genapi middleware will 401 them anyway, but the IP bucket
	// stops a flood of malformed POSTs from being free).
	profileLimiterCfg := server.ProfileLimiterDefaults()
	profileLimiterCfg.JWT = issuer
	profileLimiterCfg.TrustProxyXFF = cfg.trustProxyXFF
	if cfg.profileCRUDRPS > 0 {
		profileLimiterCfg.PerActorRate = cfg.profileCRUDRPS
	}
	if cfg.profileCRUDBurst > 0 {
		profileLimiterCfg.PerActorBurst = cfg.profileCRUDBurst
	}
	profileLimiter := server.NewProfileLimiter(profileLimiterCfg)
	return server.WrapProfileLimit(profileLimiter, limited)
}
