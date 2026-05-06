package mcpx

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func installHeaderAuthVerifier(t testing.TB) {
	t.Helper()
	SetAuthVerifier(func(r *http.Request) error {
		if strings.TrimSpace(r.Header.Get("Authorization")) == "" {
			return errors.New("missing authorization")
		}
		return nil
	})
	t.Cleanup(func() {
		SetAuthVerifier(nil)
	})
}
