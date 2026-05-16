package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"

	"geodedb.com/geode-ui/gen/pkg/obsx"
	"geodedb.com/geode-ui/internal/jwt"
	"geodedb.com/geode-ui/internal/profilestore"
)

// app_issuer.go is one of the four files that decompose the old
// monolithic newApp() per QUALITY rank 3 / #193:
//
//	app.go           — parseFlags, app type + lifecycle, newApp wiring,
//	                   serve / run / shutdown
//	app_issuer.go    — JWT key assembly, profile-store cipher loading,
//	                   profile-store rewrap sweep (SEC-NEW-7 + SEC-NEW-8)
//	app_limiters.go  — login + profile-CRUD limiter assembly
//	app_routes.go    — mux registration (REST, /ws, /mcp, /lsp, SPA)
//	app_csrf.go      — middleware chain assembly
//
// Each file owns one "concern" of newApp's old 347-LOC body. newApp now
// orchestrates those concerns instead of inlining them.

// buildJWTKeys assembles the kid → secret map and the activeKID for
// the JWT issuer per SEC-NEW-7 (#210). Two sources are honoured, in
// priority order:
//
//  1. Rotation-aware env vars: JWT_SECRET_HEX_CURRENT (required) +
//     JWT_SECRET_HEX_PREVIOUS (optional). When CURRENT is non-empty,
//     this path wins regardless of -jwt-secret-hex (which is a back-
//     compat flag).
//  2. Legacy -jwt-secret-hex CLI flag. Stamped under kid="current".
//
// The chosen activeKID is always "current" so a deploy that flips
// from legacy to rotation mode does not invalidate in-flight tokens
// — they were already stamped with kid="current" by the legacy path.
// Returns an error if neither source is configured or the supplied
// hex is malformed.
func buildJWTKeys(cliSecretHex string, getenv func(string) string) (map[string][]byte, string, error) {
	currentHex := getenv("JWT_SECRET_HEX_CURRENT")
	previousHex := getenv("JWT_SECRET_HEX_PREVIOUS")

	if currentHex != "" {
		// Rotation-aware path.
		current, err := hex.DecodeString(currentHex)
		if err != nil {
			return nil, "", fmt.Errorf("decode JWT_SECRET_HEX_CURRENT: %w", err)
		}
		keys := map[string][]byte{jwt.DefaultKID: current}
		if previousHex != "" {
			previous, err := hex.DecodeString(previousHex)
			if err != nil {
				return nil, "", fmt.Errorf("decode JWT_SECRET_HEX_PREVIOUS: %w", err)
			}
			keys[jwt.PreviousKID] = previous
		}
		return keys, jwt.DefaultKID, nil
	}

	// Legacy single-secret path.
	if cliSecretHex == "" {
		return nil, "", errors.New("missing JWT secret: set JWT_SECRET_HEX_CURRENT (and optionally JWT_SECRET_HEX_PREVIOUS for rotation) or pass -jwt-secret-hex (generate with `openssl rand -hex 32`)")
	}
	secret, err := hex.DecodeString(cliSecretHex)
	if err != nil {
		return nil, "", fmt.Errorf("decode -jwt-secret-hex: %w", err)
	}
	return map[string][]byte{jwt.DefaultKID: secret}, jwt.DefaultKID, nil
}

// buildIssuer combines key assembly and Issuer construction so newApp
// can swap an Issuer build into one call. Returns the Issuer or a
// fatal-init error.
func buildIssuer(cfg appConfig, getenv func(string) string) (*jwt.Issuer, error) {
	keys, activeKID, err := buildJWTKeys(cfg.secretHex, getenv)
	if err != nil {
		return nil, err
	}
	issuer, err := jwt.NewIssuerWithKeys(keys, activeKID, cfg.jwtTTL)
	if err != nil {
		return nil, fmt.Errorf("jwt issuer: %w", err)
	}
	return issuer, nil
}

// runProfileStoreRewrapIfRequested executes the SEC-NEW-8 (#211)
// one-shot startup sweep when -profilestore-rewrap-from is set. No-op
// when the flag is empty.
func runProfileStoreRewrapIfRequested(cfg appConfig, store profilestore.Store) error {
	if cfg.profileRewrapFromB64 == "" {
		return nil
	}
	rewrapper, ok := store.(profilestore.Rewrapper)
	if !ok {
		return fmt.Errorf("profile store rewrap: store backend does not support Rewrapper")
	}
	legacyKey, err := base64.StdEncoding.DecodeString(cfg.profileRewrapFromB64)
	if err != nil {
		return fmt.Errorf("profile store rewrap: decode legacy key: %w", err)
	}
	legacyCipher, err := profilestore.NewCipherFromKey(legacyKey)
	if err != nil {
		return fmt.Errorf("profile store rewrap: legacy cipher: %w", err)
	}
	res, err := rewrapper.RewrapSensitiveColumns(context.Background(), legacyCipher)
	if err != nil {
		return fmt.Errorf("profile store rewrap: %w", err)
	}
	obsx.LogAudit("profilestore_rewrap_complete", map[string]any{
		"rows_touched":      res.RowsTouched,
		"seals_rewritten":   res.SealsRewritten,
		"skipped_plaintext": res.SkippedPlaintext,
	})
	slog.Info("profilestore rewrap sweep complete",
		"rows_touched", res.RowsTouched,
		"seals_rewritten", res.SealsRewritten,
		"skipped_plaintext", res.SkippedPlaintext,
	)
	return nil
}
