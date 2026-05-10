package profilestore

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

// fixedKey returns a deterministic 32-byte key encoded as base64 — handy
// for testing that the same envVar value produces a working cipher.
func fixedKey(t *testing.T) string {
	t.Helper()
	var k [32]byte
	for i := range k {
		k[i] = byte(i + 1)
	}
	return base64.StdEncoding.EncodeToString(k[:])
}

func newTestCipher(t *testing.T) *Cipher {
	t.Helper()
	t.Setenv("GEODE_PROFILESTORE_KEY_TEST", fixedKey(t))
	c, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_TEST")
	if err != nil {
		t.Fatalf("NewCipherFromEnv: %v", err)
	}
	return c
}

func TestCipher_Roundtrip(t *testing.T) {
	c := newTestCipher(t)
	plaintexts := [][]byte{
		[]byte(""),
		[]byte("quic://prod-east.geode.internal:3141"),
		[]byte("-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----"),
		bytes.Repeat([]byte{0xff}, 4096),
	}
	for _, pt := range plaintexts {
		ct, err := c.Encrypt(pt)
		if err != nil {
			t.Fatalf("Encrypt(%q): %v", pt, err)
		}
		if bytes.Equal(ct, pt) && len(pt) > 0 {
			t.Fatalf("Encrypt produced ciphertext == plaintext for %q", pt)
		}
		if !IsCiphertext(ct) {
			t.Errorf("IsCiphertext returned false for fresh ciphertext (first byte=%#x)", ct[0])
		}
		out, err := c.Decrypt(ct)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if !bytes.Equal(out, pt) {
			t.Errorf("roundtrip mismatch: got %q want %q", out, pt)
		}
	}
}

func TestCipher_DistinctNoncesPerCall(t *testing.T) {
	c := newTestCipher(t)
	pt := []byte("same plaintext")
	a, err := c.Encrypt(pt)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	b, err := c.Encrypt(pt)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Equal(a, b) {
		t.Errorf("two encryptions of same plaintext produced identical ciphertext (nonce reuse)")
	}
}

func TestCipher_WrongKeyFailsAuth(t *testing.T) {
	c1 := newTestCipher(t)
	pt := []byte("secret")
	ct, err := c1.Encrypt(pt)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	// Build a second cipher with a different key.
	var k2 [32]byte
	if _, err := rand.Read(k2[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	t.Setenv("GEODE_PROFILESTORE_KEY_OTHER", base64.StdEncoding.EncodeToString(k2[:]))
	c2, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_OTHER")
	if err != nil {
		t.Fatalf("NewCipherFromEnv (other): %v", err)
	}
	if _, err := c2.Decrypt(ct); err == nil {
		t.Errorf("Decrypt with wrong key: want error, got nil")
	}
}

func TestCipher_TamperedCiphertextFailsAuth(t *testing.T) {
	c := newTestCipher(t)
	ct, err := c.Encrypt([]byte("important payload"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	// Flip a bit in the body (after sentinel + nonce).
	if len(ct) < 30 {
		t.Fatalf("ciphertext too short to tamper: %d", len(ct))
	}
	tampered := append([]byte{}, ct...)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := c.Decrypt(tampered); err == nil {
		t.Errorf("Decrypt of tampered ciphertext: want auth error, got nil")
	}
}

func TestNewCipherFromEnv_MissingEnvVar(t *testing.T) {
	t.Setenv("GEODE_PROFILESTORE_KEY_MISSING", "")
	_, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_MISSING")
	if err == nil {
		t.Fatalf("want error for empty env var, got nil")
	}
	if !strings.Contains(err.Error(), "GEODE_PROFILESTORE_KEY_MISSING") {
		t.Errorf("error should name the env var: %v", err)
	}
	if !strings.Contains(err.Error(), "openssl rand -base64 32") {
		t.Errorf("error should suggest a generator command: %v", err)
	}
}

func TestNewCipherFromEnv_BadBase64(t *testing.T) {
	t.Setenv("GEODE_PROFILESTORE_KEY_BAD", "not-base64!!!")
	_, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_BAD")
	if err == nil {
		t.Fatalf("want error for bad base64, got nil")
	}
	if !strings.Contains(err.Error(), "base64") {
		t.Errorf("error should mention base64 decode failure: %v", err)
	}
}

func TestNewCipherFromEnv_WrongLength(t *testing.T) {
	// 31 bytes — wrong length for AES-256.
	short := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xab}, 31))
	t.Setenv("GEODE_PROFILESTORE_KEY_SHORT", short)
	_, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_SHORT")
	if err == nil {
		t.Fatalf("want error for 31-byte key, got nil")
	}
	if !strings.Contains(err.Error(), "32 bytes") && !strings.Contains(err.Error(), "key length") {
		t.Errorf("error should mention required length: %v", err)
	}

	// 33 bytes — also wrong length.
	long := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xab}, 33))
	t.Setenv("GEODE_PROFILESTORE_KEY_LONG", long)
	if _, err := NewCipherFromEnv("GEODE_PROFILESTORE_KEY_LONG"); err == nil {
		t.Errorf("want error for 33-byte key, got nil")
	}
}

func TestIsCiphertext_DistinguishesPlaintext(t *testing.T) {
	c := newTestCipher(t)
	ct, err := c.Encrypt([]byte("hello"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !IsCiphertext(ct) {
		t.Errorf("IsCiphertext should detect freshly-emitted ciphertext")
	}
	cases := []struct {
		name string
		in   []byte
	}{
		{"empty", []byte{}},
		{"plain ascii", []byte("hello world")},
		{"plain PEM", []byte("-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----")},
		{"plain DSN", []byte("quic://host:3141")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if IsCiphertext(tc.in) {
				t.Errorf("IsCiphertext should return false for %q", tc.in)
			}
		})
	}
}

func TestCipher_DecryptRejectsNonCiphertext(t *testing.T) {
	c := newTestCipher(t)
	if _, err := c.Decrypt([]byte("not encrypted")); err == nil {
		t.Errorf("Decrypt of plain bytes: want error, got nil")
	}
	if _, err := c.Decrypt([]byte{}); err == nil {
		t.Errorf("Decrypt of empty input: want error, got nil")
	}
	// Sentinel-only — not enough bytes for nonce + tag.
	if _, err := c.Decrypt([]byte{ciphertextSentinelV1}); err == nil {
		t.Errorf("Decrypt of sentinel-only input: want error, got nil")
	}
}
