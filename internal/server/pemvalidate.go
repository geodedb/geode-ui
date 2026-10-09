package server

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
)

// pemvalidate.go closes GAP-S10 (#123): server-side PEM validation for
// the three TLS PEM columns accepted on POST /api/v1/profiles and
// PATCH /api/v1/profiles/{id}.
//
// Pre-fix, tlsFromGenJSON accepted any string under tls.ca_pem,
// tls.client_cert_pem, tls.client_key_pem (handlers_profiles_crud.go).
// A non-PEM blob would persist into the profile store and only fail at
// connection-establishment time, leaking the validation error onto the
// query path instead of being rejected at the CRUD boundary.
//
// Hardening:
//
//   - 64 KiB cap per field. Real-world cert chains comfortably fit
//     inside 8-16 KiB; 64 KiB is generous headroom while still
//     bounding the parser cost.
//   - pem.Decode must succeed (block != nil) AND there must be no
//     trailing garbage after the decoded block. Multi-block input
//     (e.g. a cert chain) is also allowed -- pem.Decode is called in
//     a loop on the rest, and every block in the chain must be a
//     valid CERTIFICATE.
//   - For ca / cert: every block.Type must be "CERTIFICATE" AND
//     x509.ParseCertificate must succeed on block.Bytes.
//   - For key: a single block whose Type is "PRIVATE KEY" / "RSA
//     PRIVATE KEY" / "EC PRIVATE KEY", parsed by the matching
//     stdlib parser. PKCS8 is the preferred shape; the legacy
//     PKCS1 (RSA) and SEC1 (EC) shapes are also accepted because
//     real ops teams still ship those out of cert tooling.
//
// IMPORTANT: validation errors are intentionally generic ("invalid
// CA PEM", "invalid client cert PEM", "invalid client key PEM"). We
// do NOT echo the underlying x509/pem error back to the caller --
// that would tell an attacker which parser succeeded and which
// failed (PKCS8 vs PKCS1 vs SEC1), which is a minor format-oracle
// leak. The full parser error is left for server logs (slog) if a
// future revision wants to surface it.

// maxPEMFieldSize caps the byte length of any single PEM field accepted
// over the wire. 64 KiB comfortably covers a multi-cert chain plus
// EC/Ed25519 keys with PEM armor and still bounds the worst-case
// parser cost.
const maxPEMFieldSize = 64 * 1024

// pemRoleCA marks a field that must contain one or more PEM-encoded
// X.509 certificates (the trust-anchor / chain payload).
const pemRoleCA = "CA"

// pemRoleCert is identical to pemRoleCA from the parser's perspective
// but kept as a distinct value so the error wording reflects the
// caller-visible field name ("client cert" vs "CA").
const pemRoleCert = "cert"

// pemRoleKey marks a field that must contain exactly one PEM block
// holding a parseable private key (PKCS8 / PKCS1 RSA / SEC1 EC /
// Ed25519 via PKCS8).
const pemRoleKey = "key"

// errPEMInvalidCA / errPEMInvalidCert / errPEMInvalidKey are the
// sentinel errors surfaced for the three PEM roles. Generic by design
// (see file-level comment).
var (
	errPEMInvalidCA   = errors.New("invalid CA PEM")
	errPEMInvalidCert = errors.New("invalid client cert PEM")
	errPEMInvalidKey  = errors.New("invalid client key PEM")
	errPEMTooLarge    = errors.New("PEM exceeds 64 KiB limit")
)

// validatePEM validates the supplied PEM material against the
// supplied role. Returns nil on success.
//
// Contract:
//
//   - Empty input -> nil (callers handle the absent vs empty distinction
//     upstream; an empty string at this boundary means "no material",
//     which is a valid state for an unprotected upstream).
//   - >64 KiB -> errPEMTooLarge.
//   - role == pemRoleCA / pemRoleCert: every contiguous PEM block in
//     the input must be Type=="CERTIFICATE" AND x509.ParseCertificate
//     succeeds. No trailing garbage permitted.
//   - role == pemRoleKey: exactly one PEM block, Type ∈ {PRIVATE KEY,
//     RSA PRIVATE KEY, EC PRIVATE KEY}, parsed by the matching stdlib
//     parser. No trailing garbage permitted.
func validatePEM(raw, role string) error {
	if raw == "" {
		return nil
	}
	if len(raw) > maxPEMFieldSize {
		return errPEMTooLarge
	}
	switch role {
	case pemRoleCA, pemRoleCert:
		return validateCertChainPEM(raw, role)
	case pemRoleKey:
		return validatePrivateKeyPEM(raw)
	default:
		// Defensive: an unknown role should never reach here; treat as
		// the most restrictive (cert) so a misuse fails closed.
		return validateCertChainPEM(raw, role)
	}
}

// validateCertChainPEM accepts a single certificate or a concatenated
// chain. Every block must decode + parse cleanly; trailing garbage
// (non-PEM bytes after the last END line, beyond whitespace) is
// rejected.
func validateCertChainPEM(raw, role string) error {
	mismatch := errPEMInvalidCert
	if role == pemRoleCA {
		mismatch = errPEMInvalidCA
	}
	rest := []byte(raw)
	blocks := 0
	for {
		// pem.Decode tolerates leading whitespace and comments outside
		// the BEGIN/END envelope; rest is whatever follows the decoded
		// block (may be empty, whitespace, or another PEM block).
		block, after := pem.Decode(rest)
		if block == nil {
			if blocks == 0 {
				return mismatch
			}
			// Any non-whitespace trailing bytes after the last block?
			if hasNonWhitespace(rest) {
				return mismatch
			}
			return nil
		}
		if block.Type != "CERTIFICATE" {
			return mismatch
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			return mismatch
		}
		blocks++
		rest = after
		if len(rest) == 0 {
			return nil
		}
	}
}

// validatePrivateKeyPEM expects exactly one private-key PEM block.
// Supported armor headers and parsers:
//
//   - "PRIVATE KEY"     -> x509.ParsePKCS8PrivateKey (preferred)
//   - "RSA PRIVATE KEY" -> x509.ParsePKCS1PrivateKey (legacy)
//   - "EC PRIVATE KEY"  -> x509.ParseECPrivateKey    (SEC1)
//
// The parsed key is type-asserted into a known concrete shape
// (*rsa.PrivateKey, *ecdsa.PrivateKey, ed25519.PrivateKey) before
// success is returned so a malformed-but-decodable PKCS8 envelope
// carrying an unsupported algorithm is rejected.
func validatePrivateKeyPEM(raw string) error {
	block, rest := pem.Decode([]byte(raw))
	if block == nil {
		return errPEMInvalidKey
	}
	if hasNonWhitespace(rest) {
		// More content after the key block (e.g. a stray cert) is
		// rejected; the key field is exactly-one-key.
		return errPEMInvalidKey
	}
	switch block.Type {
	case "PRIVATE KEY":
		k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return errPEMInvalidKey
		}
		switch k.(type) {
		case *rsa.PrivateKey, *ecdsa.PrivateKey, ed25519.PrivateKey:
			return nil
		default:
			return errPEMInvalidKey
		}
	case "RSA PRIVATE KEY":
		if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err != nil {
			return errPEMInvalidKey
		}
		return nil
	case "EC PRIVATE KEY":
		if _, err := x509.ParseECPrivateKey(block.Bytes); err != nil {
			return errPEMInvalidKey
		}
		return nil
	default:
		return errPEMInvalidKey
	}
}

// hasNonWhitespace reports whether b contains any byte other than
// space, tab, CR, or LF. Used to decide whether bytes following a
// decoded PEM block are real trailing garbage or just terminator
// whitespace.
func hasNonWhitespace(b []byte) bool {
	for _, c := range b {
		switch c {
		case ' ', '\t', '\r', '\n':
			continue
		default:
			return true
		}
	}
	return false
}

// validateTLSMaterialPEM runs validatePEM against each of the three
// fields on a TLSMaterial-equivalent struct. Returns the first error
// encountered, in CA -> cert -> key order. Empty fields are accepted
// (callers handle "clear" semantics upstream).
func validateTLSMaterialPEM(caPEM, certPEM, keyPEM string) error {
	if err := validatePEM(caPEM, pemRoleCA); err != nil {
		return err
	}
	if err := validatePEM(certPEM, pemRoleCert); err != nil {
		return err
	}
	return validatePEM(keyPEM, pemRoleKey)
}
