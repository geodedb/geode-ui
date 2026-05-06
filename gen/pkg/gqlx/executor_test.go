package gqlx

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestExecuteSimple(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("hello", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return "world", nil
		},
	})
	resp := Execute(context.Background(), s, `{ hello }`, nil, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["hello"] != "world" {
		t.Errorf("got %v, want world", data["hello"])
	}
}

func TestExecuteWithArgs(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("greet", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "name", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			name, _ := args["name"].(string)
			return "Hello, " + name, nil
		},
	})
	resp := Execute(context.Background(), s, `{ greet(name: "Alice") }`, nil, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["greet"] != "Hello, Alice" {
		t.Errorf("got %v", data["greet"])
	}
}

func TestExecuteWithVariables(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("greet", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "name", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			name, _ := args["name"].(string)
			return "Hi " + name, nil
		},
	})
	vars := map[string]any{"name": "Bob"}
	resp := Execute(context.Background(), s, `query ($name: String!) { greet(name: $name) }`, vars, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["greet"] != "Hi Bob" {
		t.Errorf("got %v", data["greet"])
	}
}

func TestExecuteNested(t *testing.T) {
	userType := NewObjectType("User")
	userType.AddField("name", FieldDef{Type: TypeString})

	s := NewSchema()
	s.Query.AddField("user", FieldDef{
		Type: userType,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return map[string]any{"name": "Alice"}, nil
		},
	})
	resp := Execute(context.Background(), s, `{ user { name } }`, nil, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	user, ok := data["user"].(map[string]any)
	if !ok {
		t.Fatal("expected map user")
	}
	if user["name"] != "Alice" {
		t.Errorf("got %v", user["name"])
	}
}

func TestExecuteResolverError(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("fail", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return nil, errors.New("boom")
		},
	})
	resp := Execute(context.Background(), s, `{ fail }`, nil, "", 5*time.Second)
	if len(resp.Errors) != 1 {
		t.Fatalf("expected 1 error, got %d", len(resp.Errors))
	}
	if resp.Errors[0].Message != "boom" {
		t.Errorf("got %q", resp.Errors[0].Message)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["fail"] != nil {
		t.Errorf("expected nil for failed field, got %v", data["fail"])
	}
}

func TestExecuteTimeout(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("slow", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			select {
			case <-time.After(10 * time.Second):
				return "done", nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		},
	})
	resp := Execute(context.Background(), s, `{ slow }`, nil, "", 50*time.Millisecond)
	if len(resp.Errors) == 0 {
		t.Fatal("expected timeout error")
	}
}

func TestExecuteSkipDirective(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("a", FieldDef{Type: TypeString, Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "A", nil }})
	s.Query.AddField("b", FieldDef{Type: TypeString, Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "B", nil }})

	resp := Execute(context.Background(), s, `{ a @skip(if: true) b }`, nil, "", 5*time.Second)
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if _, ok := data["a"]; ok {
		t.Error("field a should be skipped")
	}
	if data["b"] != "B" {
		t.Errorf("got %v for b", data["b"])
	}
}

func TestExecuteAuthRequired(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("public", FieldDef{
		Type:    TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "ok", nil },
	})
	s.Query.AddField("secret", FieldDef{
		Type:    TypeString,
		Auth:    "jwt",
		Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "hidden", nil },
	})

	// No AuthFunc set — field requiring auth should fail.
	resp := Execute(context.Background(), s, `{ public secret }`, nil, "", 5*time.Second)
	if len(resp.Errors) == 0 {
		t.Fatal("expected auth error for secret field")
	}
	found := false
	for _, e := range resp.Errors {
		if e.Message == ErrAuthRequired.Error() {
			found = true
		}
	}
	if !found {
		t.Errorf("expected ErrAuthRequired, got %v", resp.Errors)
	}
}

func TestExecuteAuthWithFunc(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("secret", FieldDef{
		Type:    TypeString,
		Auth:    "jwt",
		Resolve: func(ctx context.Context, args map[string]any) (any, error) { return "hidden", nil },
	})
	// Provide an AuthFunc that always returns a valid credential.
	s.AuthFunc = func(ctx context.Context) string { return "valid-token" }

	resp := Execute(context.Background(), s, `{ secret }`, nil, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["secret"] != "hidden" {
		t.Errorf("got %v, want hidden", data["secret"])
	}
}

func TestExecuteNonNullPropagation(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("required", FieldDef{
		Type: NonNullOf(TypeString),
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return nil, nil // resolver returns nil for a non-null field
		},
	})

	resp := Execute(context.Background(), s, `{ required }`, nil, "", 5*time.Second)
	// The entire data should be nil due to null propagation.
	if resp.Data != nil {
		t.Errorf("expected nil data due to null propagation, got %v", resp.Data)
	}
	if len(resp.Errors) == 0 {
		t.Fatal("expected non-null propagation error")
	}
}

func TestExecuteMutation(t *testing.T) {
	s := NewSchema()
	s.Mutation.AddField("setName", FieldDef{
		Type: TypeString,
		Args: []ArgDef{{Name: "name", Type: TypeString, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return args["name"], nil
		},
	})
	resp := Execute(context.Background(), s, `mutation { setName(name: "X") }`, nil, "", 5*time.Second)
	if len(resp.Errors) > 0 {
		t.Fatalf("errors: %v", resp.Errors)
	}
	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatal("expected map data")
	}
	if data["setName"] != "X" {
		t.Errorf("got %v", data["setName"])
	}
}
