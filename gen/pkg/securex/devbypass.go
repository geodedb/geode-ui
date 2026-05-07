package securex

import (
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

// InsecureDevEnv is the canonical environment variable that opts into the
// development-only insecure bypass flow. Callers should never rely on this
// being set in production.
const InsecureDevEnv = "GENAPI_INSECURE_DEV"

// insecureDevWarnOnce makes sure the "INSECURE_DEV bypass active" warning is
// emitted exactly once per process, the first time any call site observes the
// bypass allowing a request or startup action.
//
//nolint:gochecknoglobals // boot-time one-shot warning
var insecureDevWarnOnce sync.Once

// AllowInsecureDev reports whether the per-request INSECURE_DEV bypass should
// be honoured for this request. Three conditions must all hold:
//
//  1. The TCP peer is a loopback address. The decision is made against
//     r.RemoteAddr ONLY. X-Forwarded-For, X-Real-IP, and other proxy hints
//     are intentionally ignored so that a reverse proxy cannot be tricked
//     into forging a loopback origin.
//  2. debugMode is true. This should be derived from gin.Mode() ==
//     gin.DebugMode (or equivalent) at the call site.
//  3. The environment variable GENAPI_INSECURE_DEV is set to a truthy value
//     (1, true, yes, y, on - case insensitive).
//
// If any of the three conditions fails, the bypass is denied. A warning is
// logged at most once per process lifetime when the bypass first activates.
func AllowInsecureDev(r *http.Request, debugMode bool) bool {
	if r == nil {
		return false
	}
	if !debugMode {
		return false
	}
	if !parseBoolEnv(os.Getenv(InsecureDevEnv)) {
		return false
	}
	if !isLoopbackRemoteAddr(r.RemoteAddr) {
		return false
	}
	logInsecureDevOnce()
	return true
}

// AllowInsecureDevAtStartup is the setup-time variant of AllowInsecureDev.
// No HTTP request is available yet, so only debugMode and the environment
// variable are checked. This is the correct helper for listener wiring,
// CORS configuration, and OIDC-missing startup branches - places where the
// per-request loopback check cannot yet run.
func AllowInsecureDevAtStartup(debugMode bool) bool {
	if !debugMode {
		return false
	}
	if !parseBoolEnv(os.Getenv(InsecureDevEnv)) {
		return false
	}
	logInsecureDevOnce()
	return true
}

// parseBoolEnv mirrors the existing api/server.go and pkg/htpx/server.go
// helpers that this package supersedes. Accepts 1, true, yes, y, on (case
// insensitive, whitespace trimmed). Anything else is false.
func parseBoolEnv(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

// isLoopbackRemoteAddr returns true when the TCP peer (r.RemoteAddr) parses
// to a loopback IP. Requires the "host:port" shape that net/http populates;
// a bare host without a port is rejected.
func isLoopbackRemoteAddr(remoteAddr string) bool {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return false
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// logInsecureDevOnce writes a single structured warning the first time the
// bypass fires. Subsequent calls are no-ops.
func logInsecureDevOnce() {
	insecureDevWarnOnce.Do(func() {
		slog.Warn(
			"GENAPI_INSECURE_DEV bypass active",
			"env", InsecureDevEnv,
			"note", "loopback+debug-mode required; never enable in production",
		)
	})
}
