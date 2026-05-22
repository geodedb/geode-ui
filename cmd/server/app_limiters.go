package main

import (
	"net/http"

	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/server"
)

// app_limiters.go decomposes the limiter-construction body of newApp
// per QUALITY rank 3 / #193. See app_issuer.go for the full split map.

// buildRateLimiters wires the per-IP login limiter (SEC-F2 #58 +
// SEC-N7 #66), the per-(JWT-subject) profile-CRUD limiter (GAP-S7
// #120), and the per-IP onboard limiter (login-profile-ux follow-up
// #2) around mux. Returns the wrapped handler that newApp later feeds
// into the CSRF + httpx middleware chain.
//
// All three limiters honor cfg.trustProxyXFF (SEC-NEW-5 / #201). The
// profile-CRUD limiter additionally consumes cfg.profileCRUDRPS and
// cfg.profileCRUDBurst as overrides for the shipped defaults (the
// e2e-suite raises both above the production default; <= 0 keeps the
// default). The onboard limiter takes cfg.onboardRPS /
// cfg.onboardBurst on the same <= 0 -> default contract.
func buildRateLimiters(cfg appConfig, issuer *jwt.Issuer, mux http.Handler) http.Handler {
	// Per-IP / per-(profile, username) login limiter (SEC-F2 #58, SEC-N7
	// #66). Mounted around the mux so it observes /api/v1/auth/login
	// before the genapi-emitted route handler runs. The structural fix
	// belongs in genapi (per-IP partitioning in gen/pkg/httpx); a
	// follow-up issue is filed.
	loginLimiterCfg := server.LoginLimiterDefaults()
	loginLimiterCfg.TrustProxyXFF = cfg.trustProxyXFF
	loginLimiter := server.NewLoginLimiter(loginLimiterCfg)
	// PERF #225: spawn the TTL janitor goroutine so the per-IP +
	// per-(profile, user) maps cannot grow unbounded under an attacker
	// that rotates the bucket key (defaults: 24h MaxIdle, 5-min sweep
	// cadence, 100k MaxEntries hard cap).
	loginLimiter.StartJanitor()
	limited := server.WrapLoginLimit(loginLimiter, mux)

	// login-profile-ux follow-up #2: per-IP rate limiter on
	// POST /api/v1/profiles/onboard. The route is unauthenticated and
	// opens an upstream QUIC `*sql.DB` against a caller-supplied DSN
	// to validate caller-supplied admin credentials; without a limiter
	// it is a credential-spray amplifier (an attacker uses the
	// geode-ui process as a probe relay against arbitrary reachable
	// Geodes). Defaults: 1 rps with burst 5 — deliberately tighter
	// than the login limiter because operators onboard a small N
	// profiles total, not per-day. Mounted around the login-limiter
	// chain so its 429 + audit emission fires before the inner login
	// limiter's path filter rejects on path mismatch.
	onboardCfg := server.OnboardLimiterDefaults()
	onboardCfg.TrustProxyXFF = cfg.trustProxyXFF
	if cfg.onboardRPS > 0 {
		onboardCfg.PerIPRate = cfg.onboardRPS
	}
	if cfg.onboardBurst > 0 {
		onboardCfg.PerIPBurst = cfg.onboardBurst
	}
	onboardLimiter := server.NewOnboardLimiter(onboardCfg)
	onboardLimiter.StartJanitor()
	limited = server.WrapOnboardLimit(onboardLimiter, limited)

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
	// PERF #225: same TTL janitor coverage for the per-actor map.
	profileLimiter.StartJanitor()
	return server.WrapProfileLimit(profileLimiter, limited)
}
