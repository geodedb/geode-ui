package gqlx

import "testing"

func TestParseSimpleQuery(t *testing.T) {
	doc, err := Parse(`{ hero { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Operations) != 1 {
		t.Fatalf("got %d operations, want 1", len(doc.Operations))
	}
	op := doc.Operations[0]
	if op.Type != OperationQuery {
		t.Errorf("got op type %v, want Query", op.Type)
	}
	if len(op.Selections) != 1 {
		t.Fatalf("got %d selections, want 1", len(op.Selections))
	}
}

func TestParseNamedQuery(t *testing.T) {
	doc, err := Parse(`query HeroQuery { hero { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Operations[0].Name != "HeroQuery" {
		t.Errorf("got name %q, want HeroQuery", doc.Operations[0].Name)
	}
}

func TestParseMutation(t *testing.T) {
	doc, err := Parse(`mutation CreateUser($name: String!) { createUser(name: $name) { id } }`)
	if err != nil {
		t.Fatal(err)
	}
	op := doc.Operations[0]
	if op.Type != OperationMutation {
		t.Errorf("got op type %v, want Mutation", op.Type)
	}
	if len(op.Variables) != 1 {
		t.Fatalf("got %d vars, want 1", len(op.Variables))
	}
	if op.Variables[0].Name != "name" {
		t.Errorf("got var name %q, want name", op.Variables[0].Name)
	}
	if !op.Variables[0].Type.NonNull {
		t.Error("expected NonNull variable type")
	}
}

func TestParseSubscription(t *testing.T) {
	doc, err := Parse(`subscription { messages { text } }`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Operations[0].Type != OperationSubscription {
		t.Errorf("got op type %v, want Subscription", doc.Operations[0].Type)
	}
}

func TestParseArguments(t *testing.T) {
	doc, err := Parse(`{ user(id: "abc", active: true) { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := doc.Operations[0].Selections[0].(*Field)
	if !ok {
		t.Fatal("expected *Field")
	}
	if len(field.Arguments) != 2 {
		t.Fatalf("got %d args, want 2", len(field.Arguments))
	}
}

func TestParseAlias(t *testing.T) {
	doc, err := Parse(`{ hero: user(id: "1") { name } }`)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := doc.Operations[0].Selections[0].(*Field)
	if !ok {
		t.Fatal("expected *Field")
	}
	if field.Alias != "hero" {
		t.Errorf("got alias %q, want hero", field.Alias)
	}
	if field.Name != "user" {
		t.Errorf("got name %q, want user", field.Name)
	}
}

func TestParseFragment(t *testing.T) {
	doc, err := Parse(`
		query { hero { ...heroFields } }
		fragment heroFields on Hero { name age }
	`)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Fragments) != 1 {
		t.Fatalf("got %d fragments, want 1", len(doc.Fragments))
	}
	if doc.Fragments[0].Name != "heroFields" {
		t.Errorf("got fragment name %q, want heroFields", doc.Fragments[0].Name)
	}
}

func TestParseInlineFragment(t *testing.T) {
	doc, err := Parse(`{ hero { ... on Human { height } } }`)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := doc.Operations[0].Selections[0].(*Field)
	if !ok {
		t.Fatal("expected *Field")
	}
	if len(field.Selections) != 1 {
		t.Fatalf("got %d selections, want 1", len(field.Selections))
	}
	inf, ok := field.Selections[0].(*InlineFragment)
	if !ok {
		t.Fatal("expected InlineFragment")
	}
	if inf.TypeCondition != "Human" {
		t.Errorf("got type condition %q, want Human", inf.TypeCondition)
	}
}

func TestParseDirectives(t *testing.T) {
	doc, err := Parse(`{ hero @skip(if: true) { name @include(if: false) } }`)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := doc.Operations[0].Selections[0].(*Field)
	if !ok {
		t.Fatal("expected *Field")
	}
	if len(field.Directives) != 1 || field.Directives[0].Name != "skip" {
		t.Error("expected @skip directive")
	}
}

func TestParseVariableTypes(t *testing.T) {
	doc, err := Parse(`query ($ids: [ID!]!, $name: String = "default") { f }`)
	if err != nil {
		t.Fatal(err)
	}
	vars := doc.Operations[0].Variables
	if len(vars) != 2 {
		t.Fatalf("got %d vars, want 2", len(vars))
	}
	// $ids: [ID!]! — non-null list of non-null ID
	if !vars[0].Type.NonNull {
		t.Error("expected outer non-null for $ids")
	}
	if vars[0].Type.Elem == nil {
		t.Fatal("expected list type for $ids")
	}
	// $name has default "default"
	sv, ok := vars[1].Default.(*StringValue)
	if !ok || sv.V != "default" {
		t.Error("expected default string value 'default'")
	}
}

func TestParseRejectsIntrospection(t *testing.T) {
	cases := []string{
		`{ __schema { types { name } } }`,
		`{ __type(name: "User") { name } }`,
	}
	for _, c := range cases {
		_, err := Parse(c)
		if err == nil {
			t.Errorf("expected error for introspection query: %s", c)
		}
	}
}

func TestParseAllowsTypename(t *testing.T) {
	// __typename is allowed in nested selections, just not at root
	_, err := Parse(`{ hero { __typename name } }`)
	if err != nil {
		t.Errorf("__typename should be allowed in nested selections: %v", err)
	}
}

func TestParseInvalidSyntax(t *testing.T) {
	cases := []string{
		`query {`,     // unclosed brace
		`{`,           // unclosed
		`{ field( }`,  // unclosed paren
		`{ field }}}`, // extra braces
	}
	for _, c := range cases {
		_, err := Parse(c)
		if err == nil {
			t.Errorf("expected parse error for: %s", c)
		}
	}
}
