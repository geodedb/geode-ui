package gqlx

import (
	"context"
	"testing"
)

func TestSchemaAddField(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("hello", FieldDef{
		Type: TypeString,
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return "world", nil
		},
	})
	f, ok := s.Query.Field("hello")
	if !ok {
		t.Fatal("field hello not found")
	}
	if f.Type != TypeString {
		t.Error("expected String type")
	}
}

func TestSchemaBuiltinScalars(t *testing.T) {
	for _, sc := range []GQLType{TypeString, TypeInt, TypeFloat, TypeBoolean, TypeID} {
		if sc.TypeName() == "" {
			t.Error("scalar has empty name")
		}
	}
}

func TestSchemaListType(t *testing.T) {
	lt := ListOf(TypeString)
	if lt.TypeName() != "[String]" {
		t.Errorf("got %q, want [String]", lt.TypeName())
	}
}

func TestSchemaNonNullType(t *testing.T) {
	nn := NonNullOf(TypeString)
	if nn.TypeName() != "String!" {
		t.Errorf("got %q, want String!", nn.TypeName())
	}
}

func TestSchemaObjectType(t *testing.T) {
	obj := NewObjectType("User")
	obj.AddField("name", FieldDef{Type: TypeString})
	obj.AddField("age", FieldDef{Type: TypeInt})
	if obj.TypeName() != "User" {
		t.Errorf("got %q, want User", obj.TypeName())
	}
	_, ok := obj.Field("name")
	if !ok {
		t.Error("field name not found")
	}
}

func TestSchemaFieldArgs(t *testing.T) {
	s := NewSchema()
	s.Query.AddField("user", FieldDef{
		Type: TypeString,
		Args: []ArgDef{
			{Name: "id", Type: TypeID, Required: true},
			{Name: "name", Type: TypeString},
		},
		Resolve: func(ctx context.Context, args map[string]any) (any, error) {
			return args["id"], nil
		},
	})
	f, _ := s.Query.Field("user")
	if len(f.Args) != 2 {
		t.Errorf("got %d args, want 2", len(f.Args))
	}
	if !f.Args[0].Required {
		t.Error("expected id to be required")
	}
}

func TestSchemaFieldsOrder(t *testing.T) {
	obj := NewObjectType("Test")
	obj.AddField("c", FieldDef{Type: TypeString})
	obj.AddField("a", FieldDef{Type: TypeString})
	obj.AddField("b", FieldDef{Type: TypeString})
	names := obj.Fields()
	if len(names) != 3 {
		t.Fatalf("got %d fields, want 3", len(names))
	}
	// Should be in insertion order
	if names[0] != "c" || names[1] != "a" || names[2] != "b" {
		t.Errorf("got fields %v, want [c a b]", names)
	}
}
