package conn

import "testing"

func TestProfileScopeValid(t *testing.T) {
	tests := []struct {
		name  string
		scope ProfileScope
		want  bool
	}{
		{"system valid", ProfileScopeSystem, true},
		{"personal valid", ProfileScopePersonal, true},
		{"unknown invalid", ProfileScope("other"), false},
		{"empty invalid", ProfileScope(""), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.scope.Valid(); got != tc.want {
				t.Errorf("Valid() = %v, want %v", got, tc.want)
			}
		})
	}
}
