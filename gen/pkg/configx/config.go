package configx

import (
	"bytes"
	"encoding/json/v2"
	"fmt"
)

// TLSConfig defines TLS paths and optional mTLS CA bundle.
type TLSConfig struct {
	CertPath   string  `json:"cert_path"`
	KeyPath    string  `json:"key_path"`
	MTLSCAPath *string `json:"mtls_ca_path"`
}

// TimeoutConfig defines HTTP server timeout values in milliseconds.
type TimeoutConfig struct {
	ReadHeaderMS int `json:"read_header_ms"`
	ReadMS       int `json:"read_ms"`
	WriteMS      int `json:"write_ms"`
	IdleMS       int `json:"idle_ms"`
}

// LimitConfig defines request-size limits.
type LimitConfig struct {
	MaxHeaderBytes int   `json:"max_header_bytes"`
	MaxBodyBytes   int64 `json:"max_body_bytes"`
}

// ServerConfig defines runtime server bind/tls/timeout/limit settings.
type ServerConfig struct {
	Bind     string        `json:"bind"`
	TLS      TLSConfig     `json:"tls"`
	Timeouts TimeoutConfig `json:"timeouts"`
	Limits   LimitConfig   `json:"limits"`
}

// AuthConfig defines global auth mechanisms.
type AuthConfig struct {
	APIKey      bool   `json:"api_key"`
	JWT         bool   `json:"jwt"`
	JWTIssuer   string `json:"jwt_issuer,omitempty"`
	JWTAudience string `json:"jwt_audience,omitempty"`
}

// CORSConfig defines CORS enablement and origins.
type CORSConfig struct {
	Enabled bool     `json:"enabled"`
	Origins []string `json:"origins"`
}

// RateLimitConfig defines global rate-limit defaults.
type RateLimitConfig struct {
	GlobalRPS int `json:"global_rps"`
	Burst     int `json:"burst"`
}

// SecurityConfig defines top-level security options.
type SecurityConfig struct {
	Auth      AuthConfig      `json:"auth"`
	CORS      CORSConfig      `json:"cors"`
	RateLimit RateLimitConfig `json:"rate_limit"`
	Roles     []string        `json:"roles,omitempty"`
}

// MCPConfig defines enabled MCP transports.
type MCPConfig struct {
	Transport []string `json:"transport"`
}

// ObservabilityConfig controls optional debug and profiling endpoints.
type ObservabilityConfig struct {
	EnableDebug bool `json:"enable_debug"`
}

// RuntimeConfig is the canonical runtime config contract used by generator and server.
type RuntimeConfig struct {
	Server        ServerConfig        `json:"server"`
	Security      SecurityConfig      `json:"security"`
	MCP           MCPConfig           `json:"mcp"`
	Observability ObservabilityConfig `json:"observability"`
}

// DecodeRuntimeConfig decodes strict JSON into RuntimeConfig.
func DecodeRuntimeConfig(raw []byte) (RuntimeConfig, error) {
	var cfg RuntimeConfig
	if err := json.UnmarshalRead(
		bytes.NewReader(raw), &cfg,
		json.RejectUnknownMembers(true),
	); err != nil {
		return RuntimeConfig{}, fmt.Errorf("decode runtime config: %w", err)
	}
	return cfg, nil
}
