package gqlx

// OperationType enumerates the three root operation kinds in GraphQL.
type OperationType int

const (
	OperationQuery OperationType = iota
	OperationMutation
	OperationSubscription
)

// Document is the top-level AST node produced by the parser.
type Document struct {
	Operations []*Operation
	Fragments  []*FragmentDef
}

// Operation represents a single query, mutation, or subscription.
type Operation struct {
	Type       OperationType
	Name       string
	Variables  []*VariableDef
	Directives []*Directive
	Selections []Selection
}

// VariableDef captures a variable declaration inside an operation.
type VariableDef struct {
	Name    string
	Type    TypeRef
	Default Value
}

// TypeRef models named, list, and non-null type references.
type TypeRef struct {
	Name    string
	Elem    *TypeRef
	NonNull bool
}

// Selection is implemented by Field, FragmentSpread, and InlineFragment.
type Selection interface {
	selectionNode()
}

// Field is a single field selection, optionally aliased and nested.
type Field struct {
	Alias      string
	Name       string
	Arguments  []*Argument
	Directives []*Directive
	Selections []Selection
}

func (*Field) selectionNode() {}

// FragmentSpread references a named fragment definition.
type FragmentSpread struct {
	Name       string
	Directives []*Directive
}

func (*FragmentSpread) selectionNode() {}

// InlineFragment is an anonymous fragment with an optional type condition.
type InlineFragment struct {
	TypeCondition string
	Directives    []*Directive
	Selections    []Selection
}

func (*InlineFragment) selectionNode() {}

// FragmentDef is a named fragment definition.
type FragmentDef struct {
	Name          string
	TypeCondition string
	Directives    []*Directive
	Selections    []Selection
}

// Directive represents an @-prefixed directive application.
type Directive struct {
	Name      string
	Arguments []*Argument
}

// Argument is a key-value pair passed to a field or directive.
type Argument struct {
	Name  string
	Value Value
}

// Value is implemented by all GraphQL value literal types.
type Value interface {
	valueNode()
}

// StringValue holds a GraphQL string literal.
type StringValue struct{ V string }

// IntValue holds a GraphQL integer literal.
type IntValue struct{ V int64 }

// FloatValue holds a GraphQL float literal.
type FloatValue struct{ V float64 }

// BoolValue holds a GraphQL boolean literal.
type BoolValue struct{ V bool }

// NullValue represents the GraphQL null literal.
type NullValue struct{}

// EnumValue holds a GraphQL enum literal.
type EnumValue struct{ V string }

// ListValue holds a GraphQL list literal.
type ListValue struct{ Values []Value }

// ObjectValue holds a GraphQL input object literal.
type ObjectValue struct{ Fields []*ObjectField }

// VariableValue references a variable by name.
type VariableValue struct{ Name string }

// ObjectField is a single field inside an ObjectValue.
type ObjectField struct {
	Name  string
	Value Value
}

func (*StringValue) valueNode()   {}
func (*IntValue) valueNode()      {}
func (*FloatValue) valueNode()    {}
func (*BoolValue) valueNode()     {}
func (*NullValue) valueNode()     {}
func (*EnumValue) valueNode()     {}
func (*ListValue) valueNode()     {}
func (*ObjectValue) valueNode()   {}
func (*VariableValue) valueNode() {}
