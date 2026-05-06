package securex

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newCertChain(t *testing.T, ekus []x509.ExtKeyUsage) *x509.Certificate {
	t.Helper()
	return &x509.Certificate{ExtKeyUsage: ekus}
}

func newReqWithTLS(t *testing.T, peerCerts []*x509.Certificate, verifiedChains [][]*x509.Certificate) *http.Request {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	r.TLS = &tls.ConnectionState{
		PeerCertificates: peerCerts,
		VerifiedChains:   verifiedChains,
	}
	return r
}

func TestVerifyMTLS_RejectsRequestWithoutTLS(t *testing.T) {
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if err := VerifyMTLS(r, MTLSPolicy{Required: true}); !errors.Is(err, ErrMTLSCertMissing) {
		t.Fatalf("err = %v, want ErrMTLSCertMissing", err)
	}
}

func TestVerifyMTLS_RejectsNilRequest(t *testing.T) {
	if err := VerifyMTLS(nil, MTLSPolicy{Required: true}); !errors.Is(err, ErrMTLSCertMissing) {
		t.Fatalf("err = %v, want ErrMTLSCertMissing", err)
	}
}

func TestVerifyMTLS_RejectsMissingCertWhenRequired(t *testing.T) {
	r := newReqWithTLS(t, nil, nil)
	if err := VerifyMTLS(r, MTLSPolicy{Required: true}); !errors.Is(err, ErrMTLSCertMissing) {
		t.Fatalf("err = %v, want ErrMTLSCertMissing", err)
	}
}

func TestVerifyMTLS_AllowsMissingCertWhenNotRequired(t *testing.T) {
	r := newReqWithTLS(t, nil, nil)
	if err := VerifyMTLS(r, MTLSPolicy{Required: false}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

func TestVerifyMTLS_RejectsUnverifiedCert(t *testing.T) {
	leaf := newCertChain(t, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, nil) // VerifiedChains intentionally empty
	if err := VerifyMTLS(r, MTLSPolicy{Required: true}); !errors.Is(err, ErrMTLSCertNotVerified) {
		t.Fatalf("err = %v, want ErrMTLSCertNotVerified", err)
	}
}

func TestVerifyMTLS_RejectsCertMissingClientAuthEKU(t *testing.T) {
	leaf := newCertChain(t, []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth})
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, [][]*x509.Certificate{{leaf}})
	policy := MTLSPolicy{Required: true, EKUValidation: true}
	if err := VerifyMTLS(r, policy); !errors.Is(err, ErrMTLSCertEKUMissing) {
		t.Fatalf("err = %v, want ErrMTLSCertEKUMissing", err)
	}
}

func TestVerifyMTLS_AcceptsCertWithClientAuthEKU(t *testing.T) {
	leaf := newCertChain(t, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, [][]*x509.Certificate{{leaf}})
	policy := MTLSPolicy{Required: true, EKUValidation: true}
	if err := VerifyMTLS(r, policy); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

func TestVerifyMTLS_AcceptsCertWithExtKeyUsageAny(t *testing.T) {
	leaf := newCertChain(t, []x509.ExtKeyUsage{x509.ExtKeyUsageAny})
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, [][]*x509.Certificate{{leaf}})
	policy := MTLSPolicy{Required: true, EKUValidation: true}
	if err := VerifyMTLS(r, policy); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

func TestVerifyMTLS_SkipsEKUCheckWhenDisabled(t *testing.T) {
	// No EKU set on the leaf; with EKUValidation=false this must still pass.
	leaf := newCertChain(t, nil)
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, [][]*x509.Certificate{{leaf}})
	if err := VerifyMTLS(r, MTLSPolicy{Required: true}); err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
}

func TestVerifyMTLS_SupportedIssuersIsAdvisoryOnly(t *testing.T) {
	// Documented contract: VerifyMTLS does NOT enforce supported_issuers.
	// That mapping is deployment-specific (PIV/CAC/custom) and lives in
	// the caller-supplied opts.AuthMTLS hook. This test pins the contract.
	leaf := newCertChain(t, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})
	r := newReqWithTLS(t, []*x509.Certificate{leaf}, [][]*x509.Certificate{{leaf}})
	policy := MTLSPolicy{
		Required:         true,
		EKUValidation:    true,
		SupportedIssuers: []string{"piv", "cac"}, // never satisfied by leaf above
	}
	if err := VerifyMTLS(r, policy); err != nil {
		t.Fatalf("VerifyMTLS must not enforce SupportedIssuers, got err = %v", err)
	}
}
