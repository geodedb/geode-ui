package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

// pemvalidate_test.go pins GAP-S10 (#123): server-side PEM validation
// for the three TLS PEM columns.

// genTestCAPEM returns a self-signed CA certificate PEM (CERTIFICATE
// armor) for use as test fixture material. The cert is valid for 10
// years from now and uses an EC P-256 key (cheaper than RSA at
// generate-time so the test suite stays fast).
func genTestCAPEM(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// genTestClientCertPEM returns a self-signed client cert PEM. Same
// shape as the CA helper but without IsCA.
func genTestClientCertPEM(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "test-client"},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// genTestPKCS8KeyPEM returns a PKCS8-encoded EC P-256 private key PEM.
func genTestPKCS8KeyPEM(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// genTestRSAPKCS1KeyPEM returns a legacy PKCS1 RSA private key PEM
// (RSA PRIVATE KEY armor). Real-world tooling still emits these.
func genTestRSAPKCS1KeyPEM(t *testing.T) string {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa key: %v", err)
	}
	der := x509.MarshalPKCS1PrivateKey(priv)
	return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}))
}

// genTestECSEC1KeyPEM returns a SEC1-encoded EC private key PEM
// (EC PRIVATE KEY armor).
func genTestECSEC1KeyPEM(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa key: %v", err)
	}
	der, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatalf("MarshalECPrivateKey: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}))
}

func TestValidatePEM_AcceptsValidCA(t *testing.T) {
	t.Parallel()
	pemBytes := genTestCAPEM(t)
	if err := validatePEM(pemBytes, pemRoleCA); err != nil {
		t.Errorf("valid CA PEM rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsValidCert(t *testing.T) {
	t.Parallel()
	pemBytes := genTestClientCertPEM(t)
	if err := validatePEM(pemBytes, pemRoleCert); err != nil {
		t.Errorf("valid client cert PEM rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsValidPKCS8Key(t *testing.T) {
	t.Parallel()
	pemBytes := genTestPKCS8KeyPEM(t)
	if err := validatePEM(pemBytes, pemRoleKey); err != nil {
		t.Errorf("valid PKCS8 EC key rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsLegacyRSAPKCS1Key(t *testing.T) {
	t.Parallel()
	pemBytes := genTestRSAPKCS1KeyPEM(t)
	if err := validatePEM(pemBytes, pemRoleKey); err != nil {
		t.Errorf("valid PKCS1 RSA key rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsLegacyECSEC1Key(t *testing.T) {
	t.Parallel()
	pemBytes := genTestECSEC1KeyPEM(t)
	if err := validatePEM(pemBytes, pemRoleKey); err != nil {
		t.Errorf("valid SEC1 EC key rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsCertChain(t *testing.T) {
	t.Parallel()
	a := genTestCAPEM(t)
	b := genTestClientCertPEM(t)
	if err := validatePEM(a+b, pemRoleCA); err != nil {
		t.Errorf("two-cert chain rejected: %v", err)
	}
}

func TestValidatePEM_AcceptsEmptyString(t *testing.T) {
	t.Parallel()
	// Per W4 / PSR-G02 contract: empty input is the "absent / clear"
	// signal; it must NOT be validated as PEM.
	for _, role := range []string{pemRoleCA, pemRoleCert, pemRoleKey} {
		if err := validatePEM("", role); err != nil {
			t.Errorf("empty %s PEM rejected: %v", role, err)
		}
	}
}

func TestValidatePEM_RejectsGarbage(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
	}{
		{"plain text", "not a pem"},
		{"json blob", `{"foo":"bar"}`},
		{"random bytes", "\x00\x01\x02\x03\x04\x05"},
		{"truncated header", "-----BEGIN CERTIFICATE-----\nMIIB"},
		{"empty header", "-----BEGIN -----\n-----END -----\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if err := validatePEM(tc.in, pemRoleCA); err == nil {
				t.Errorf("CA: garbage accepted: %q", tc.in)
			}
			if err := validatePEM(tc.in, pemRoleCert); err == nil {
				t.Errorf("cert: garbage accepted: %q", tc.in)
			}
			if err := validatePEM(tc.in, pemRoleKey); err == nil {
				t.Errorf("key: garbage accepted: %q", tc.in)
			}
		})
	}
}

// TestValidatePEM_RejectsKeyInCAField pins the negative cross-role
// case: a syntactically valid PRIVATE KEY armor must NOT pass when
// the field expects a CERTIFICATE.
func TestValidatePEM_RejectsKeyInCAField(t *testing.T) {
	t.Parallel()
	keyPEM := genTestPKCS8KeyPEM(t)
	if err := validatePEM(keyPEM, pemRoleCA); err == nil {
		t.Errorf("key block accepted under CA role")
	}
	if err := validatePEM(keyPEM, pemRoleCert); err == nil {
		t.Errorf("key block accepted under cert role")
	}
}

// TestValidatePEM_RejectsCertInKeyField is the mirror of the above:
// a CERTIFICATE block must NOT pass when the field expects a key.
func TestValidatePEM_RejectsCertInKeyField(t *testing.T) {
	t.Parallel()
	certPEM := genTestCAPEM(t)
	if err := validatePEM(certPEM, pemRoleKey); err == nil {
		t.Errorf("cert block accepted under key role")
	}
}

// TestValidatePEM_RejectsOversize pins the 64 KiB cap.
func TestValidatePEM_RejectsOversize(t *testing.T) {
	t.Parallel()
	// 64 KiB + 1 of any payload (parser never sees this; size is
	// the only check that runs).
	huge := strings.Repeat("A", maxPEMFieldSize+1)
	for _, role := range []string{pemRoleCA, pemRoleCert, pemRoleKey} {
		err := validatePEM(huge, role)
		if err == nil {
			t.Errorf("%s: oversized input accepted", role)
		}
		if !errors.Is(err, errPEMTooLarge) {
			t.Errorf("%s: want errPEMTooLarge, got %v", role, err)
		}
	}
}

// TestValidatePEM_RejectsTrailingGarbage ensures non-PEM bytes after
// the last block fail validation -- defensive against PEM-then-blob
// smuggling.
func TestValidatePEM_RejectsTrailingGarbage(t *testing.T) {
	t.Parallel()
	cert := genTestCAPEM(t)
	if err := validatePEM(cert+"trailing-garbage", pemRoleCA); err == nil {
		t.Errorf("CA: trailing garbage accepted")
	}
	key := genTestPKCS8KeyPEM(t)
	if err := validatePEM(key+"trailing-garbage", pemRoleKey); err == nil {
		t.Errorf("key: trailing garbage accepted")
	}
}

// TestValidatePEM_RejectsExtraBlockAfterKey ensures a key field
// carrying a key followed by a stray cert is rejected -- the key
// field is exactly-one-key.
func TestValidatePEM_RejectsExtraBlockAfterKey(t *testing.T) {
	t.Parallel()
	key := genTestPKCS8KeyPEM(t)
	cert := genTestCAPEM(t)
	if err := validatePEM(key+cert, pemRoleKey); err == nil {
		t.Errorf("key+cert accepted under key role")
	}
}

// TestValidatePEM_RejectsCorruptCertBytes ensures a syntactically
// valid PEM block whose body is not parseable DER fails.
func TestValidatePEM_RejectsCorruptCertBytes(t *testing.T) {
	t.Parallel()
	// Hand-built PEM with junk bytes inside.
	junk := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: []byte{0x01, 0x02, 0x03, 0x04, 0x05},
	})
	if err := validatePEM(string(junk), pemRoleCA); err == nil {
		t.Errorf("CA: malformed DER accepted")
	}
}

// TestValidateTLSMaterialPEM_AllValid spot-checks the three-field
// helper used directly by tlsFromGenJSON.
func TestValidateTLSMaterialPEM_AllValid(t *testing.T) {
	t.Parallel()
	ca := genTestCAPEM(t)
	cert := genTestClientCertPEM(t)
	key := genTestPKCS8KeyPEM(t)
	if err := validateTLSMaterialPEM(ca, cert, key); err != nil {
		t.Errorf("valid TLS material rejected: %v", err)
	}
}

// TestValidateTLSMaterialPEM_AllEmpty reflects the PSR-G02 clear path:
// an all-empty TLSMaterial is accepted (caller's "clear all" signal).
func TestValidateTLSMaterialPEM_AllEmpty(t *testing.T) {
	t.Parallel()
	if err := validateTLSMaterialPEM("", "", ""); err != nil {
		t.Errorf("all-empty TLS material rejected: %v", err)
	}
}

// TestValidateTLSMaterialPEM_OneFieldBad confirms the per-field error
// short-circuit: a bad CA fails before cert/key are even inspected.
func TestValidateTLSMaterialPEM_OneFieldBad(t *testing.T) {
	t.Parallel()
	ca := "not a pem"
	cert := genTestClientCertPEM(t)
	key := genTestPKCS8KeyPEM(t)
	err := validateTLSMaterialPEM(ca, cert, key)
	if err == nil {
		t.Errorf("bad CA accepted alongside good cert/key")
	}
	if !errors.Is(err, errPEMInvalidCA) {
		t.Errorf("expected errPEMInvalidCA, got %v", err)
	}
}
