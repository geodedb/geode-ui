package server

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"

	gentypes "geodedb.com/geode-ui/gen/types"
)

// GetCapabilities implements GET /api/v1/capabilities.
//
// This is a read endpoint — every authenticated user may consult it
// (no admin-role requirement). The genapi wrapper handles auth/CSRF as
// for the other GET routes. It exists so the SPA can gate the
// "+ New user/role/policy" CTAs and the Grants Apply/Revoke buttons on
// whether the connected Geode build actually accepts the corresponding
// admin DDL over the wire — see UsersPage / RolesPage / PoliciesPage /
// GrantsPanel and the useCapabilities() hook. The create *actions*
// remain admin-gated server-side regardless of what this returns.
//
// Response shape:
//
//	{
//	  "geode_version": "<version string>",
//	  "admin_writable": { "users": false, "roles": false,
//	                      "policies": false, "grants": false }
//	}
func (s *GraphServer) GetCapabilities(w http.ResponseWriter, _ *http.Request, _ *gentypes.Empty) (*gentypes.Capabilities, error) {
	// TODO(geode-wire-rbac): this is the geode-ui build version, not the
	// connected Geode build's version. Geode does not currently expose
	// its build over the GQL wire — there is no `SHOW VERSION` statement,
	// no `version()` builtin, and the QUIC HELLO handshake's
	// HelloResponse carries no server-version field — so there is no
	// accessor on the driver/pool to read it from. When Geode grows one
	// (a wire statement, a HELLO field, or a `geode version`-style RPC),
	// resolve it here via connDB()/the pool and fall back to
	// s.cfg.Version only on error.
	geodeVersion := s.cfg.Version

	// TODO(geode-wire-rbac): Geode does not yet implement CREATE USER / CREATE
	// ROLE / CREATE POLICY / GRANT over the GQL wire (the parser has no such
	// statement variants — every such POST returns wire_feature_missing /
	// status_class=42000). When that wire support lands, replace these statics
	// with detection: either a Geode-version floor check (admin_writable iff
	// geodeVersion >= "<floor>") or a one-time startup probe per family that
	// issues a harmless statement and inspects isWireFeatureMissing. The SPA
	// already gates the create CTAs on these flags, so flipping them here is
	// the only change needed downstream.
	adminWritable, err := json.Marshal(map[string]bool{
		"users":    false,
		"roles":    false,
		"policies": false,
		"grants":   false,
	})
	if err != nil {
		// map[string]bool always marshals cleanly; treat any failure as a
		// 500 via the generated wrapper.
		return nil, err
	}

	return &gentypes.Capabilities{
		GeodeVersion:  geodeVersion,
		AdminWritable: jsontext.Value(adminWritable),
	}, nil
}
