package gqlx

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func securitySchema() *Schema {
	s := NewSchema()
	userType := NewObjectType("User")
	userType.AddField("name", FieldDef{Type: TypeString})
	userType.AddField("friends", FieldDef{Type: ListOf(userType)})

	s.Query.AddField("user", FieldDef{
		Type: userType,
		Args: []ArgDef{{Name: "id", Type: TypeID, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return map[string]any{"name": "test", "friends": []any{}}, nil
		},
	})
	s.Query.AddField("public", FieldDef{
		Type:    TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "ok", nil },
	})
	s.Query.AddField("secret", FieldDef{
		Type:    TypeString,
		Auth:    "jwt",
		Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "classified", nil },
	})
	return s
}

func TestSecurityDepthBomb(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{ user(id: "1")`)
	for range 20 {
		b.WriteString(` { friends`)
	}
	b.WriteString(` { name }`)
	for range 20 {
		b.WriteString(` }`)
	}
	b.WriteString(` }`)

	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
		MaxDepth: 5, MaxComplexity: 1000, MaxAliases: 10,
	})
	body, _ := json.Marshal(map[string]string{"query": b.String()})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Errors) == 0 {
		t.Error("expected depth error")
	}
}

func TestSecurityComplexityBomb(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{`)
	for i := range 50 {
		fmt.Fprintf(&b, ` a%d: public`, i)
	}
	b.WriteString(` }`)

	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
		MaxDepth: 10, MaxComplexity: 10, MaxAliases: 100,
	})
	body, _ := json.Marshal(map[string]string{"query": b.String()})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Errors) == 0 {
		t.Error("expected complexity error")
	}
}

func TestSecurityAliasBomb(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{`)
	for i := range 20 {
		fmt.Fprintf(&b, ` a%d: public`, i)
	}
	b.WriteString(` }`)

	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
		MaxDepth: 10, MaxComplexity: 1000, MaxAliases: 5,
	})
	body, _ := json.Marshal(map[string]string{"query": b.String()})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Errors) == 0 {
		t.Error("expected alias limit error")
	}
}

func TestSecurityIntrospectionBlocked(t *testing.T) {
	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
	})
	queries := []string{
		`{"query":"{ __schema { types { name } } }"}`,
		`{"query":"{ __type(name: \"User\") { name } }"}`,
	}
	for _, q := range queries {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(q))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		var resp Response
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if len(resp.Errors) == 0 {
			t.Errorf("expected introspection error for %s", q)
		}
	}
}

func TestSecurityBatchAbuse(t *testing.T) {
	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 2,
	})
	batch := make([]map[string]string, 10)
	for i := range batch {
		batch[i] = map[string]string{"query": "{ public }"}
	}
	body, _ := json.Marshal(batch)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestSecurityFragmentCycle(t *testing.T) {
	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
	})
	body := `{"query":"query { user(id: \"1\") { ...A } } fragment A on User { ...B name } fragment B on User { ...A name }"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Errors) == 0 {
		t.Error("expected fragment cycle error")
	}
}

func TestSecurityResourceExhaustion(t *testing.T) {
	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 50, MaxBatchSize: 5,
	})
	longQuery := `{"query":"{ ` + strings.Repeat("public ", 100) + `}"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(longQuery))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestSecurityInjectionViaVariables(t *testing.T) {
	h := NewHandler(securitySchema(), HandlerOptions{
		Timeout: 5 * time.Second, MaxQueryBytes: 4096, MaxBatchSize: 5,
	})
	body := `{"query":"query ($id: ID!) { user(id: $id) { name } }","variables":{"id":"'; DROP TABLE users; --"}}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/graphql", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
