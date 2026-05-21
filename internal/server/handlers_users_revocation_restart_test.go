package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	gentypes "geodedb.com/geode-ui/gen/types"
	"geodedb.com/geode-ui/internal/jwt"

	_ "modernc.org/sqlite"
)

// TestUsers_ChangePassword_RevocationSurvivesRestart is the SEC-N2
// follow-up integration check: a password change revokes the user's
// existing token (per-user revoke-all), and that revocation is durable —
// "restarting" the server (a fresh Issuer + a fresh revocation set
// re-hydrated from the SAME SQLite file) still rejects the pre-change
// token.
//
// It mirrors the production wiring: the revocation set is backed by the
// profile-store SQLite DB via AttachSQLite, exactly as cmd/server does.
func TestUsers_ChangePassword_RevocationSurvivesRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatalf("rand: %v", err)
	}

	// --- "process 1": issue a token, change the password, observe revoke.
	iss1, err := jwt.NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	db1 := openRestartTestDB(t, dbPath)
	if err := iss1.Revocation().AttachSQLite(db1); err != nil {
		t.Fatalf("AttachSQLite (process 1): %v", err)
	}

	d := &userDriver{}
	if _, loaded := registerOnce.LoadOrStore("users_chpw_revoke_restart", struct{}{}); !loaded {
		sql.Register("users_chpw_revoke_restart", d)
	}
	upstream, err := sql.Open("users_chpw_revoke_restart", "")
	if err != nil {
		t.Fatalf("sql.Open upstream: %v", err)
	}
	t.Cleanup(func() { _ = upstream.Close() })
	s := New(Config{Version: "test", Pool: &stubPool{db: upstream}, JWT: iss1})

	tok, _, err := iss1.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := iss1.Parse(tok); err != nil {
		t.Fatalf("token should be valid before the password change: %v", err)
	}

	rec := httptest.NewRecorder()
	reqAlice := httptest.NewRequest(http.MethodPost, "/api/v1/users/alice/password", nil)
	reqAlice = reqAlice.WithContext(context.WithValue(reqAlice.Context(), userCtxKey, "alice"))
	if _, err := s.Password(rec, reqAlice, &gentypes.PasswordChangeReq{
		Username:    "alice",
		NewPassword: "fresh-secret-1",
	}); err != nil {
		t.Fatalf("Password: %v", err)
	}
	if _, err := iss1.Parse(tok); err == nil {
		t.Fatal("pre-change token should be revoked after the password change")
	}
	_ = db1.Close()

	// --- "process 2": restart. Fresh Issuer (same secret), fresh
	// revocation set re-hydrated from the same SQLite file.
	iss2, err := jwt.NewIssuer(secret, time.Hour)
	if err != nil {
		t.Fatalf("NewIssuer (process 2): %v", err)
	}
	db2 := openRestartTestDB(t, dbPath)
	if err := iss2.Revocation().AttachSQLite(db2); err != nil {
		t.Fatalf("AttachSQLite (process 2): %v", err)
	}
	if _, err := iss2.Parse(tok); err == nil {
		t.Fatal("pre-change token should STILL be rejected after a restart (durable revocation)")
	}

	// A token issued for the same user *after* the "restart" — its iat is
	// strictly after the persisted password-change instant (whole-second
	// granularity may collide, so wait out the second boundary), so the
	// re-hydrated revocation set lets it through. This is the real
	// re-login-after-password-change flow.
	time.Sleep(1100 * time.Millisecond)
	freshTok, _, err := iss2.Issue("alice", "default", []string{"reader"}, "")
	if err != nil {
		t.Fatalf("Issue (process 2): %v", err)
	}
	if _, err := iss2.Parse(freshTok); err != nil {
		t.Fatalf("a token issued after the password change must validate after a restart: %v", err)
	}
}

func openRestartTestDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}
