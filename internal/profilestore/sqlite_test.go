package profilestore

import (
	"context"
	"testing"
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
