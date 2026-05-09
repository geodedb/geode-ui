package profilestore

import (
	"context"
	"errors"
	"testing"
	"time"

	"geodedb.com/geode-ui/internal/conn"
)

func TestSQLiteOpenAppliesSchema(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	got, err := st.List(context.Background(), Filter{})
	if err != nil {
		t.Fatalf("List on empty store: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 rows, got %d", len(got))
	}
}

func TestSQLitePutGetRoundTrip(t *testing.T) {
	st, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer func() { _ = st.Close() }()

	in := conn.Profile{
		Scope:         conn.ProfileScopePersonal,
		OwnerUserID:   "alice",
		Name:          "prod-east",
		DSN:           "quic://prod-east.geode.internal:3141",
		Description:   "Eastern prod cluster",
		SavedUsername: "alice",
		Default:       true,
		TLS: conn.TLSMaterial{
			CAPEM: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
		},
		PoolOverrides: conn.PoolOverrides{
			MaxOpenConns:    32,
			ConnMaxLifetime: 90 * time.Second,
		},
	}
	saved, err := st.Put(context.Background(), in)
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("Put returned empty ID")
	}

	got, err := st.Get(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != in.Name || got.DSN != in.DSN {
		t.Errorf("identity mismatch: got=%+v", got)
	}
	if got.PoolOverrides.MaxOpenConns != 32 ||
		got.PoolOverrides.ConnMaxLifetime != 90*time.Second {
		t.Errorf("pool overrides mismatch: got=%+v", got.PoolOverrides)
	}
	if got.TLS.CAPEM != in.TLS.CAPEM {
		t.Errorf("TLS CAPEM mismatch")
	}
	if !got.Default {
		t.Errorf("Default flag lost")
	}
}

func TestSQLitePutConflict(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	base := conn.Profile{Scope: conn.ProfileScopePersonal, OwnerUserID: "u", Name: "n", DSN: "stub://x"}
	if _, err := st.Put(context.Background(), base); err != nil {
		t.Fatalf("first Put: %v", err)
	}
	if _, err := st.Put(context.Background(), base); !errors.Is(err, ErrConflict) {
		t.Errorf("duplicate Put: want ErrConflict, got %v", err)
	}
}

func TestSQLitePutValidation(t *testing.T) {
	st, _ := OpenSQLite(":memory:")
	defer func() { _ = st.Close() }()
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScope("bogus"), Name: "n", DSN: "x"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("bogus scope: want ErrInvalid, got %v", err)
	}
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScopeSystem, DSN: "x"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("missing name: want ErrInvalid, got %v", err)
	}
	if _, err := st.Put(context.Background(), conn.Profile{Scope: conn.ProfileScopeSystem, Name: "n"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("missing dsn: want ErrInvalid, got %v", err)
	}
}
