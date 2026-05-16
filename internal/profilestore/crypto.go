package profilestore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
)

// Wire format for v1 ciphertext is a single sentinel byte (so legacy
// plaintext rows in the SQLite store can still be read on first run)
// followed by the GCM nonce and the GCM ciphertext+tag:
//
//	[ ciphertextSentinelV1 ][ 12-byte nonce ][ ciphertext || 16-byte tag ]
//
// The sentinel byte is 0x01. Plaintext PEM material always starts with
// '-' (0x2D), and DSN strings always start with a printable ASCII byte
// in the [0x20, 0x7E] range (e.g. 'q' for quic://). Picking 0x01 keeps
// IsCiphertext unambiguous for every input we expect to encounter.
//
// AES-256-GCM is fixed for v1: 32-byte key, 12-byte nonce, 16-byte tag.
// Key rotation, if ever required, would emit a new sentinel byte (0x02,
// ...) and the read path would dispatch on the leading byte.
const (
	ciphertextSentinelV1 byte = 0x01
	gcmNonceSize         int  = 12
	cipherKeySize        int  = 32
)

// Cipher encrypts and decrypts opaque byte strings using AES-256-GCM.
//
// A single Cipher value is safe for concurrent use by multiple
// goroutines: cipher.AEAD is goroutine-safe by construction (it does
// not retain per-call state) and we use crypto/rand for every nonce.
type Cipher struct {
	aead cipher.AEAD
}

// NewCipherFromEnv loads a base64-encoded 32-byte key from the named
// environment variable and returns a Cipher initialised with it.
//
// The key contract is documented at the call site (cmd/server/main.go)
// and in deploy/Dockerfile / deploy/docker-compose.example.yml. It must
// be EXACTLY 32 raw bytes after base64 decoding (256-bit AES key). The
// error message includes the env var name AND the recommended generator
// command so an operator who hits the failure mode can self-recover.
//
// Returns an error if the env var is missing, not valid base64, or
// decodes to a non-32-byte key. AES-256-GCM rejects keys of any other
// length at the cipher.NewGCM layer, but we surface the length error
// up here so the operator sees "key length 31 bytes (need 32)" rather
// than the cryptic "crypto/aes: invalid key size 31".
func NewCipherFromEnv(envVar string) (*Cipher, error) {
	return NewCipherFromEnvFunc(os.Getenv, envVar)
}

// NewCipherFromEnvFunc is NewCipherFromEnv with the environment lookup
// injected. Pass os.Getenv for the production path; tests (and the
// server bootstrap, which threads a getenv closure for hermeticity) pass
// their own. A nil getenv falls back to os.Getenv. The error contract is
// identical to NewCipherFromEnv.
func NewCipherFromEnvFunc(getenv func(string) string, envVar string) (*Cipher, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	raw := getenv(envVar)
	if raw == "" {
		return nil, fmt.Errorf(
			"profilestore: env var %s is required for at-rest encryption "+
				"(generate one with: `openssl rand -base64 32`)",
			envVar,
		)
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf(
			"profilestore: env var %s: base64 decode: %w",
			envVar, err,
		)
	}
	if len(key) != cipherKeySize {
		return nil, fmt.Errorf(
			"profilestore: env var %s: key length %d bytes (need %d) — "+
				"generate a fresh one with: `openssl rand -base64 32`",
			envVar, len(key), cipherKeySize,
		)
	}
	return NewCipherFromKey(key)
}

// NewCipherFromKey returns a Cipher initialised with the supplied raw
// 32-byte AES-256 key. Exposed mostly for tests; production callers
// should use NewCipherFromEnv so the key never lives in a Go literal.
func NewCipherFromKey(key []byte) (*Cipher, error) {
	if len(key) != cipherKeySize {
		return nil, fmt.Errorf(
			"profilestore: key length %d bytes (need %d)",
			len(key), cipherKeySize,
		)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("profilestore: aes.NewCipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("profilestore: cipher.NewGCM: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt seals plaintext with AES-256-GCM. Output layout:
//
//	[ sentinel(1) ][ nonce(12) ][ ciphertext+tag(N+16) ]
//
// A fresh CSPRNG nonce is drawn for every call. Encrypt MUST NOT be
// called with a deterministic nonce path; the GCM security argument
// collapses if a (key, nonce) pair is ever reused.
//
// Encrypt accepts an empty plaintext: the resulting ciphertext is
// 1 + 12 + 16 = 29 bytes and round-trips back to the empty slice.
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, gcmNonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("profilestore: nonce: %w", err)
	}
	out := make([]byte, 0, 1+gcmNonceSize+len(plaintext)+c.aead.Overhead())
	out = append(out, ciphertextSentinelV1)
	out = append(out, nonce...)
	out = c.aead.Seal(out, nonce, plaintext, nil)
	return out, nil
}

// Decrypt opens a v1 ciphertext produced by Encrypt and returns the
// underlying plaintext. Returns an error if the input does not start
// with the v1 sentinel, is too short to hold a nonce + tag, or fails
// GCM authentication.
//
// Decrypt explicitly does NOT accept legacy plaintext rows — that
// dispatch happens in the SQLite store via IsCiphertext, so the caller
// can choose to either return the bytes verbatim (legacy migration
// path) or fail loudly. Hiding the dispatch in Decrypt would mask a
// programming error where ciphertext is mistakenly passed where
// plaintext was expected.
func (c *Cipher) Decrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, errors.New("profilestore: decrypt: empty input")
	}
	if ciphertext[0] != ciphertextSentinelV1 {
		return nil, fmt.Errorf(
			"profilestore: decrypt: unknown ciphertext sentinel %#x (want %#x)",
			ciphertext[0], ciphertextSentinelV1,
		)
	}
	if len(ciphertext) < 1+gcmNonceSize+c.aead.Overhead() {
		return nil, errors.New("profilestore: decrypt: ciphertext truncated")
	}
	nonce := ciphertext[1 : 1+gcmNonceSize]
	body := ciphertext[1+gcmNonceSize:]
	plain, err := c.aead.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("profilestore: decrypt: %w", err)
	}
	return plain, nil
}

// IsCiphertext reports whether b appears to be v1-format ciphertext
// emitted by Encrypt. The check is intentionally cheap (single byte
// compare) — actual authenticity is verified by Decrypt's GCM tag.
//
// Legacy plaintext rows from before encryption was rolled out start
// with one of: PEM '-' (0x2D), DSN scheme letter (a-z / A-Z), or — for
// an empty column — nothing at all. None collide with the v1 sentinel
// 0x01, so a single byte compare is a reliable dispatch.
func IsCiphertext(b []byte) bool {
	return len(b) > 0 && b[0] == ciphertextSentinelV1
}

// Rewrap (SEC-NEW-8 / #211) re-encrypts a single sealed value under the
// receiver's key. The input must be a v1 ciphertext produced by `prev`;
// the output is a fresh v1 ciphertext produced by `c` (with a fresh
// nonce). Used by the on-startup `-profilestore-rewrap-from <hex>` sweep
// to migrate every sealed column from the legacy key to the active key
// without forcing a full SQLite export/import round-trip.
//
// Rewrap is idempotent if `prev == c` (the input round-trips back to a
// fresh nonce-randomised ciphertext of identical plaintext). Operators
// using the rewrap sweep should re-run it after dropping the legacy key
// to confirm no rows remain sealed under it (the second pass will hit
// "decrypt: <gcm tag>" and abort, which is the desired fail-loud).
//
// Rewrap returns an error if prev or c is nil, prev.Decrypt fails on the
// supplied bytes (including the "not ciphertext" case), or c.Encrypt
// fails (only on crypto/rand exhaustion).
func (c *Cipher) Rewrap(prev *Cipher, sealed []byte) ([]byte, error) {
	if c == nil {
		return nil, errors.New("profilestore: rewrap: receiver cipher is nil")
	}
	if prev == nil {
		return nil, errors.New("profilestore: rewrap: prev cipher is nil")
	}
	if !IsCiphertext(sealed) {
		return nil, fmt.Errorf(
			"profilestore: rewrap: input is not v1 ciphertext (first byte %#x, want %#x)",
			func() byte {
				if len(sealed) == 0 {
					return 0
				}
				return sealed[0]
			}(), ciphertextSentinelV1,
		)
	}
	plain, err := prev.Decrypt(sealed)
	if err != nil {
		return nil, fmt.Errorf("profilestore: rewrap: decrypt under prev: %w", err)
	}
	resealed, err := c.Encrypt(plain)
	if err != nil {
		return nil, fmt.Errorf("profilestore: rewrap: encrypt under new: %w", err)
	}
	return resealed, nil
}
