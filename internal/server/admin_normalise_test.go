package server

import "testing"

// S-NEW-B (#304): NFKC + case-fold canonicalisation pinned at the
// ingestion + lookup boundary. Without this an upstream username
// "BOB" would never match a configured "bob" and the bootstrap admin
// gate would silently fail to grant the admin role.

func TestNormaliseAdminLookupKey(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"whitespace only", "  \t  ", ""},
		{"ascii lower passes through", "bob", "bob"},
		{"ascii upper folded", "BOB", "bob"},
		{"ascii mixed folded", "BoB", "bob"},
		{"trim surrounding whitespace", "  alice  ", "alice"},
		// Fullwidth Latin "ＢＯＢ" (U+FF22 U+FF2F U+FF22) → NFKC → "BOB"
		// → case-fold → "bob".
		{"fullwidth latin", "ＢＯＢ", "bob"},
		// Ligature: "ﬁ" (U+FB01 LATIN SMALL LIGATURE FI) → NFKC → "fi"
		{"ligature", "Roﬁgo", "rofigo"},
		// Sharp-S German: "ß" → case-fold → "ss" (Unicode default
		// case-folding produces the multi-character form).
		{"sharp-s german", "straße", "strasse"},
		// Combining marks: NFKC normalises decomposed sequences.
		// "é" written as e + U+0301 → "é" precomposed (or vice versa).
		{"decomposed é", "é", "é"},
		// Already-canonical precomposed form is idempotent.
		{"precomposed é", "é", "é"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormaliseAdminLookupKey(tc.in)
			if got != tc.want {
				t.Errorf("NormaliseAdminLookupKey(%q) = %q, want %q",
					tc.in, got, tc.want)
			}
		})
	}
}

// End-to-end pinning: a Config built with the lower-case "bob" must
// grant admin to upstream usernames "BOB" and "ＢＯＢ" via the
// shared canonicalisation path. Pre-S-NEW-B these cases failed open
// silently — the bootstrap admin gate never fired.
func TestAdminRolesFor_FoldsCaseAndFullwidth_S_NEW_B(t *testing.T) {
	s := &GraphServer{cfg: Config{
		AdminUsernames: map[string]bool{"bob": true},
	}}
	for _, candidate := range []string{"BOB", "Bob", "ＢＯＢ", "  bob  "} {
		roles := s.adminRolesFor(candidate, nil)
		gotAdmin := false
		for _, r := range roles {
			if r == "admin" {
				gotAdmin = true
				break
			}
		}
		if !gotAdmin {
			t.Errorf("adminRolesFor(%q): admin role NOT granted (S-NEW-B regression)", candidate)
		}
	}
	// Negative case: a different name still fails to gain admin.
	if roles := s.adminRolesFor("eve", nil); len(roles) != 0 {
		t.Errorf("adminRolesFor(eve) = %v; want empty", roles)
	}
}
