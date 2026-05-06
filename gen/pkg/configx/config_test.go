package configx

import (
	"testing"
)

func TestDecodeRuntimeConfigStrictUnknownField(t *testing.T) {
	_, err := DecodeRuntimeConfig([]byte(`{"server":{"bind":"127.0.0.1:8443","tls":{"cert_path":"a","key_path":"b"},"timeouts":{"read_header_ms":1000,"read_ms":1000,"write_ms":1000,"idle_ms":1000},"limits":{"max_header_bytes":8192,"max_body_bytes":1048576}},"security":{"auth":{"api_key":true,"jwt":true},"cors":{"enabled":true,"origins":["https://example.com"]},"rate_limit":{"global_rps":100,"burst":20}},"mcp":{"transport":["http"]},"observability":{"enable_debug":false},"extra":1}`))
	if err == nil {
		t.Fatal("expected unknown-field decode error")
	}
}

func TestDecodeRuntimeConfigOK(t *testing.T) {
	cfg, err := DecodeRuntimeConfig([]byte(`{"server":{"bind":"127.0.0.1:8443","tls":{"cert_path":"a","key_path":"b","mtls_ca_path":"ca"},"timeouts":{"read_header_ms":1000,"read_ms":1000,"write_ms":1000,"idle_ms":1000},"limits":{"max_header_bytes":8192,"max_body_bytes":1048576}},"security":{"auth":{"api_key":true,"jwt":true,"jwt_issuer":"https://issuer.example","jwt_audience":"api://svc"},"cors":{"enabled":true,"origins":["https://example.com"]},"rate_limit":{"global_rps":100,"burst":20}},"mcp":{"transport":["http","stdio"]},"observability":{"enable_debug":true}}`))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if cfg.Server.Bind != "127.0.0.1:8443" {
		t.Fatalf("unexpected bind: %s", cfg.Server.Bind)
	}
	if cfg.Server.Limits.MaxBodyBytes != 1048576 {
		t.Fatalf("unexpected max_body_bytes: %d", cfg.Server.Limits.MaxBodyBytes)
	}
	if len(cfg.MCP.Transport) != 2 {
		t.Fatalf("unexpected transport length: %d", len(cfg.MCP.Transport))
	}
	if cfg.Security.Auth.JWTIssuer != "https://issuer.example" {
		t.Fatalf("unexpected jwt_issuer: %q", cfg.Security.Auth.JWTIssuer)
	}
	if cfg.Security.Auth.JWTAudience != "api://svc" {
		t.Fatalf("unexpected jwt_audience: %q", cfg.Security.Auth.JWTAudience)
	}
}
