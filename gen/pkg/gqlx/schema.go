package gqlx

import "context"

// ResolverFunc is the signature for field resolver functions. It receives
// a context and a map of parsed arguments, returning the resolved value
// or an error.
type ResolverFunc func(ctx context.Context, args map[string]any) (any, error)

// SubscribeFunc is the signature for subscription resolver functions. It
// returns a channel that emits values for as long as the subscription is
// active. Closing the channel ends the subscription.
type SubscribeFunc func(ctx context.Context, args map[string]any) (<-chan any, error)

// GQLType is the interface implemented by all GraphQL type descriptors.
// The unexported marker method prevents external packages from
// implementing the interface.
type GQLType interface {
	TypeName() string
	gqlTypeNode()
}

// ScalarType represents a built-in or custom GraphQL scalar.
type ScalarType struct {
	Name string
}

func (s *ScalarType) TypeName() string { return s.Name }
func (s *ScalarType) gqlTypeNode()     {}

// Built-in scalar types per the GraphQL specification.
var (
	TypeString  = &ScalarType{Name: "String"}
	TypeInt     = &ScalarType{Name: "Int"}
	TypeFloat   = &ScalarType{Name: "Float"}
	TypeBoolean = &ScalarType{Name: "Boolean"}
	TypeID      = &ScalarType{Name: "ID"}
)

// ObjectType represents a GraphQL object type with named fields.
// Fields maintain insertion order for deterministic output while
// also supporting O(1) lookup by name.
type ObjectType struct {
	name      string
	fieldMap  map[string]FieldDef
	fieldKeys []string
}

func (o *ObjectType) TypeName() string { return o.name }
func (o *ObjectType) gqlTypeNode()     {}

// AddField registers a field definition under the given name. If a field
// with the same name already exists, it is replaced but the insertion
// position is preserved.
func (o *ObjectType) AddField(name string, f FieldDef) {
	if _, exists := o.fieldMap[name]; !exists {
		o.fieldKeys = append(o.fieldKeys, name)
	}
	o.fieldMap[name] = f
}

// Field looks up a field by name. Returns the definition and true if
// found, or a zero FieldDef and false otherwise.
func (o *ObjectType) Field(name string) (FieldDef, bool) {
	f, ok := o.fieldMap[name]
	return f, ok
}

// Fields returns field names in insertion order.
func (o *ObjectType) Fields() []string {
	out := make([]string, len(o.fieldKeys))
	copy(out, o.fieldKeys)
	return out
}

// NewObjectType creates a new ObjectType with the given name and
// initialized internal storage.
func NewObjectType(name string) *ObjectType {
	return &ObjectType{
		name:     name,
		fieldMap: make(map[string]FieldDef),
	}
}

// ListType wraps another GQLType to represent a GraphQL list ([T]).
type ListType struct {
	Elem GQLType
}

func (l *ListType) TypeName() string { return "[" + l.Elem.TypeName() + "]" }
func (l *ListType) gqlTypeNode()     {}

// NonNullType wraps another GQLType to represent a non-null GraphQL type (T!).
type NonNullType struct {
	Elem GQLType
}

func (n *NonNullType) TypeName() string { return n.Elem.TypeName() + "!" }
func (n *NonNullType) gqlTypeNode()     {}

// ListOf wraps a GQLType in a ListType.
func ListOf(t GQLType) *ListType {
	return &ListType{Elem: t}
}

// NonNullOf wraps a GQLType in a NonNullType.
func NonNullOf(t GQLType) *NonNullType {
	return &NonNullType{Elem: t}
}

// FieldDef describes a single field on an ObjectType, including its
// return type, arguments, metadata, and resolver function.
type FieldDef struct {
	Type        GQLType
	Args        []ArgDef
	Description string
	Auth        string
	RateLimit   int
	Resolve     ResolverFunc
	Subscribe   SubscribeFunc
}

// ArgDef describes a single argument accepted by a field.
type ArgDef struct {
	Name     string
	Type     GQLType
	Default  any
	Required bool
}

// AuthFunc extracts an auth credential from the context. Return a
// non-empty string if the credential is present and valid.
type AuthFunc func(ctx context.Context) string

// Schema holds the three root operation types for a GraphQL service.
type Schema struct {
	Query        *ObjectType
	Mutation     *ObjectType
	Subscription *ObjectType

	// AuthFunc is called to enforce field-level auth. When a FieldDef has
	// a non-empty Auth string the executor calls AuthFunc; if it returns
	// "" the field is rejected with ErrAuthRequired.
	AuthFunc AuthFunc
}

// NewSchema creates a Schema with initialized root types for Query,
// Mutation, and Subscription.
func NewSchema() *Schema {
	return &Schema{
		Query:        NewObjectType("Query"),
		Mutation:     NewObjectType("Mutation"),
		Subscription: NewObjectType("Subscription"),
	}
}
