package profilestore

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// boolAsInt encodes a bool as 1 or 0 for SQLite INTEGER storage.
func boolAsInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// newID returns a 16-byte hex-encoded random identifier. modernc.org/
// sqlite does not provide UUIDv7; for v0 a CSPRNG hex is sufficient —
// globally unique with overwhelming probability and indexed efficiently
// as TEXT.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// isUniqueViolation matches modernc.org/sqlite's UNIQUE-constraint
// error wrappers. The driver does not expose a typed error code, so
// we substring-match the message text. Both phrasings have been
// observed depending on driver version.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "constraint failed: UNIQUE")
}
