package mcpx

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func installHeaderAuthVerifier(t testing.TB) {
	t.Helper()
	SetAuthVerifier(func(r *http.Request) (context.Context, error) {
		if strings.TrimSpace(r.Header.Get("Authorization")) == "" {
			return nil, errors.New("missing authorization")
		}
		return r.Context(), nil
	})
	t.Cleanup(func() {
		SetAuthVerifier(nil)
	})
}
