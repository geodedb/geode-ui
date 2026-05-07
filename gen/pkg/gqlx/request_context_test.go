package gqlx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestContextRoundTrip(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/graphql", nil)
	ctx := ContextWithRequest(context.Background(), req)
	got, ok := RequestFromContext(ctx)
	if !ok || got != req {
		t.Fatalf("expected request in context")
	}
}

func TestRequestFromContextMissing(t *testing.T) {
	if got, ok := RequestFromContext(context.Background()); ok || got != nil {
		t.Fatalf("expected nil,false when request value is missing")
	}
}
