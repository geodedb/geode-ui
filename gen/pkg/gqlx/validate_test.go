package gqlx

import (
	"context"
	"errors"
	"testing"
)

func testSchema() *Schema {
	s := NewSchema()
	userType := NewObjectType("User")
	userType.AddField("name", FieldDef{Type: TypeString})
	userType.AddField("age", FieldDef{Type: TypeInt})
	userType.AddField("friends", FieldDef{Type: ListOf(userType)})

	s.Query.AddField("user", FieldDef{
		Type: userType,
		Args: []ArgDef{{Name: "id", Type: TypeID, Required: true}},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return nil, nil
		},
	})
	s.Query.AddField("users", FieldDef{Type: ListOf(userType)})
	return s
}

func TestValidateDepthLimit(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`{ user(id: "1") { friends { friends { friends { friends { name } } } } } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 3}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrDepthExceeded) {
		t.Errorf("expected ErrDepthExceeded, got %v", err)
	}
}

func TestValidateDepthOK(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`{ user(id: "1") { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 100, MaxAliases: 10}
	if err := Validate(doc, s, opts); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateComplexityLimit(t *testing.T) {
	s := testSchema()
	// users is a list (cost=10), each with friends (cost=10*10=100) — exceeds 50
	doc, err := Parse(`{ users { friends { name } } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 50, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrComplexityExceeded) {
		t.Errorf("expected ErrComplexityExceeded, got %v", err)
	}
}

func TestValidateAliasLimit(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`{
		a1: user(id: "1") { name }
		a2: user(id: "2") { name }
		a3: user(id: "3") { name }
	}`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 1000, MaxAliases: 2}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrAliasLimitExceeded) {
		t.Errorf("expected ErrAliasLimitExceeded, got %v", err)
	}
}

func TestValidateFieldNotFound(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`{ user(id: "1") { nonexistent } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 100, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrFieldNotFound) {
		t.Errorf("expected ErrFieldNotFound, got %v", err)
	}
}

func TestValidateRequiredArg(t *testing.T) {
	s := testSchema()
	// user requires "id" argument
	doc, err := Parse(`{ user { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 100, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrInvalidArgument) {
		t.Errorf("expected ErrInvalidArgument, got %v", err)
	}
}

func TestValidateFragmentCycle(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`
		query { user(id: "1") { ...A } }
		fragment A on User { ...B name }
		fragment B on User { ...A age }
	`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 1000, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrFragmentCycle) {
		t.Errorf("expected ErrFragmentCycle, got %v", err)
	}
}

func TestValidateVariableUnused(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`query ($id: ID!, $unused: String) { user(id: $id) { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 100, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrVariableUnused) {
		t.Errorf("expected ErrVariableUnused, got %v", err)
	}
}

func TestValidateVariableNotDefined(t *testing.T) {
	s := testSchema()
	doc, err := Parse(`query { user(id: $missing) { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	opts := ValidateOptions{MaxDepth: 10, MaxComplexity: 100, MaxAliases: 10}
	err = Validate(doc, s, opts)
	if !errors.Is(err, ErrVariableNotDefined) {
		t.Errorf("expected ErrVariableNotDefined, got %v", err)
	}
}
