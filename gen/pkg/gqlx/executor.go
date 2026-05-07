package gqlx

import (
	"context"
	"fmt"
	"maps"
	"time"
)

// Execute parses, validates, and executes a GraphQL query against the
// given schema. It never returns a Go error; all errors are wrapped in
// the Response.Errors slice. Variables supplies runtime variable values,
// operationName selects a specific operation when the document contains
// more than one, and timeout limits individual resolver execution time.
// An optional ValidateOptions may be provided; when absent sensible
// defaults are used.
func Execute(ctx context.Context, schema *Schema, query string, variables map[string]any, operationName string, timeout time.Duration, vopts ...ValidateOptions) *Response {
	doc, err := Parse(query)
	if err != nil {
		return &Response{
			Errors: []*GQLError{{Message: err.Error()}},
		}
	}

	opts := ValidateOptions{
		MaxDepth:      10,
		MaxComplexity: 100,
		MaxAliases:    10,
	}
	if len(vopts) > 0 {
		opts = vopts[0]
	}
	if err := Validate(doc, schema, opts); err != nil {
		return &Response{
			Errors: []*GQLError{{Message: err.Error()}},
		}
	}

	if variables == nil {
		variables = make(map[string]any)
	}

	exec := &executor{
		schema:    schema,
		variables: variables,
		fragments: make(map[string]*FragmentDef, len(doc.Fragments)),
		timeout:   timeout,
	}
	for _, frag := range doc.Fragments {
		exec.fragments[frag.Name] = frag
	}

	// Select the operation to execute.
	op, gqlErr := exec.selectOperation(doc, operationName)
	if gqlErr != nil {
		return &Response{Errors: []*GQLError{gqlErr}}
	}

	return exec.executeOperation(ctx, op)
}

// executor holds the state for a single execution pass.
type executor struct {
	schema    *Schema
	variables map[string]any
	fragments map[string]*FragmentDef
	timeout   time.Duration
}

// selectOperation picks the operation to run. If operationName is empty
// and there is exactly one operation, it uses that one. Otherwise it
// searches by name.
func (e *executor) selectOperation(doc *Document, name string) (*Operation, *GQLError) {
	if len(doc.Operations) == 0 {
		return nil, &GQLError{Message: "no operations in document"}
	}

	if name == "" {
		if len(doc.Operations) == 1 {
			return doc.Operations[0], nil
		}
		return nil, &GQLError{Message: "operation name required when document contains multiple operations"}
	}

	for _, op := range doc.Operations {
		if op.Name == name {
			return op, nil
		}
	}
	return nil, &GQLError{Message: fmt.Sprintf("operation %q not found", name)}
}

// executeOperation resolves the root type and executes the selection set.
func (e *executor) executeOperation(ctx context.Context, op *Operation) *Response {
	rootType := e.rootType(op.Type)
	if rootType == nil {
		return &Response{
			Errors: []*GQLError{{Message: "no root type for operation"}},
		}
	}

	data, errs := e.executeSelectionSet(ctx, op.Selections, rootType, nil)
	// Avoid wrapping a nil map in the any interface (Go nil interface
	// gotcha: typed nil != untyped nil).
	resp := &Response{Errors: errs}
	if data != nil {
		resp.Data = data
	}
	return resp
}

// rootType returns the ObjectType corresponding to the operation kind.
func (e *executor) rootType(opType OperationType) *ObjectType {
	switch opType {
	case OperationQuery:
		return e.schema.Query
	case OperationMutation:
		return e.schema.Mutation
	case OperationSubscription:
		return e.schema.Subscription
	default:
		return e.schema.Query
	}
}

// executeSelectionSet processes a list of selections against a parent
// object type, using source as the parent result for default field
// resolution.
func (e *executor) executeSelectionSet(ctx context.Context, selections []Selection, parentType *ObjectType, source map[string]any) (map[string]any, []*GQLError) {
	result := make(map[string]any)
	var errs []*GQLError

	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			if e.shouldSkip(s.Directives) {
				continue
			}

			responseKey := s.Name
			if s.Alias != "" {
				responseKey = s.Alias
			}

			fieldDef, ok := parentType.Field(s.Name)
			if !ok {
				// __typename is a built-in meta field.
				if s.Name == "__typename" {
					result[responseKey] = parentType.TypeName()
					continue
				}
				errs = append(errs, &GQLError{
					Message: fmt.Sprintf("field %q not found on type %q", s.Name, parentType.TypeName()),
					Path:    []any{responseKey},
				})
				result[responseKey] = nil
				continue
			}

			val, fieldErrs := e.resolveField(ctx, s, fieldDef, source)
			errs = append(errs, fieldErrs...)

			// Handle nested object fields.
			if val != nil && len(s.Selections) > 0 {
				val, fieldErrs = e.completeValue(ctx, s, fieldDef.Type, val)
				errs = append(errs, fieldErrs...)
			}

			// NonNull enforcement: if a non-null field resolved to nil,
			// null-propagate to the parent per the GraphQL spec.
			if val == nil {
				if _, nn := fieldDef.Type.(*NonNullType); nn {
					errs = append(errs, &GQLError{
						Message: fmt.Sprintf("non-null field %q resolved to null", responseKey),
						Path:    []any{responseKey},
					})
					return nil, errs
				}
			}

			result[responseKey] = val

		case *FragmentSpread:
			if e.shouldSkip(s.Directives) {
				continue
			}
			frag, ok := e.fragments[s.Name]
			if !ok {
				continue
			}
			fragData, fragErrs := e.executeSelectionSet(ctx, frag.Selections, parentType, source)
			errs = append(errs, fragErrs...)
			maps.Copy(result, fragData)

		case *InlineFragment:
			if e.shouldSkip(s.Directives) {
				continue
			}
			fragData, fragErrs := e.executeSelectionSet(ctx, s.Selections, parentType, source)
			errs = append(errs, fragErrs...)
			maps.Copy(result, fragData)
		}
	}

	return result, errs
}

// completeValue handles sub-selection resolution for object and list
// types. It recursively resolves nested fields. When a NonNull-wrapped
// field resolves to nil the error is propagated upward per the GraphQL
// spec (the nearest nullable parent is nullified).
func (e *executor) completeValue(ctx context.Context, field *Field, typ GQLType, val any) (any, []*GQLError) {
	// Handle NonNull: if the inner value completes to nil, propagate the
	// error by returning nil (the caller will null-out the parent).
	if nn, ok := typ.(*NonNullType); ok {
		completed, errs := e.completeValue(ctx, field, nn.Elem, val)
		if completed == nil {
			responseKey := field.Name
			if field.Alias != "" {
				responseKey = field.Alias
			}
			errs = append(errs, &GQLError{
				Message: fmt.Sprintf("non-null field %q resolved to null", responseKey),
				Path:    []any{responseKey},
			})
			return nil, errs
		}
		return completed, errs
	}

	// Handle list types.
	if lt, ok := typ.(*ListType); ok {
		list, ok := val.([]any)
		if !ok {
			return val, nil
		}
		results := make([]any, len(list))
		var errs []*GQLError
		for i, elem := range list {
			completed, elemErrs := e.completeValue(ctx, field, lt.Elem, elem)
			results[i] = completed
			errs = append(errs, elemErrs...)
		}
		return results, errs
	}

	// Handle object types with sub-selections.
	if objType, ok := typ.(*ObjectType); ok {
		m, ok := val.(map[string]any)
		if !ok {
			return val, nil
		}
		return e.executeSelectionSet(ctx, field.Selections, objType, m)
	}

	return val, nil
}

// resolveField invokes the resolver for a field, falling back to source
// map lookup when no resolver is provided.
func (e *executor) resolveField(ctx context.Context, field *Field, fieldDef FieldDef, source map[string]any) (any, []*GQLError) {
	// Enforce field-level auth when specified.
	if fieldDef.Auth != "" {
		if e.schema.AuthFunc == nil || e.schema.AuthFunc(ctx) == "" {
			responseKey := field.Name
			if field.Alias != "" {
				responseKey = field.Alias
			}
			return nil, []*GQLError{{
				Message: ErrAuthRequired.Error(),
				Path:    []any{responseKey},
			}}
		}
	}

	args := e.coerceArgs(field.Arguments)

	if fieldDef.Resolve != nil {
		resolveCtx, cancel := context.WithTimeout(ctx, e.timeout)
		defer cancel()

		val, err := fieldDef.Resolve(resolveCtx, args)
		if err != nil {
			responseKey := field.Name
			if field.Alias != "" {
				responseKey = field.Alias
			}
			return nil, []*GQLError{{
				Message: err.Error(),
				Path:    []any{responseKey},
			}}
		}
		return val, nil
	}

	// Default resolution: look up field name in source map.
	if source != nil {
		return source[field.Name], nil
	}

	return nil, nil
}

// coerceArgs converts AST Argument nodes into a Go map of values,
// resolving variables as needed.
func (e *executor) coerceArgs(args []*Argument) map[string]any {
	if len(args) == 0 {
		return nil
	}
	result := make(map[string]any, len(args))
	for _, arg := range args {
		result[arg.Name] = e.coerceValue(arg.Value)
	}
	return result
}

// coerceValue converts a single AST Value node into a Go value.
func (e *executor) coerceValue(val Value) any {
	switch v := val.(type) {
	case *StringValue:
		return v.V
	case *IntValue:
		return v.V
	case *FloatValue:
		return v.V
	case *BoolValue:
		return v.V
	case *NullValue:
		return nil
	case *EnumValue:
		return v.V
	case *VariableValue:
		return e.variables[v.Name]
	case *ListValue:
		list := make([]any, len(v.Values))
		for i, elem := range v.Values {
			list[i] = e.coerceValue(elem)
		}
		return list
	case *ObjectValue:
		obj := make(map[string]any, len(v.Fields))
		for _, f := range v.Fields {
			obj[f.Name] = e.coerceValue(f.Value)
		}
		return obj
	default:
		return nil
	}
}

// shouldSkip evaluates @skip(if:) and @include(if:) directives. A field
// is skipped when @skip(if: true) is present or @include(if: false) is
// present.
func (e *executor) shouldSkip(directives []*Directive) bool {
	for _, d := range directives {
		switch d.Name {
		case "skip":
			if e.directiveIf(d) {
				return true
			}
		case "include":
			if !e.directiveIf(d) {
				return true
			}
		}
	}
	return false
}

// directiveIf extracts the boolean value of the "if" argument from a
// directive. Returns false when the argument is missing or not a boolean.
func (e *executor) directiveIf(d *Directive) bool {
	for _, arg := range d.Arguments {
		if arg.Name == "if" {
			val := e.coerceValue(arg.Value)
			b, ok := val.(bool)
			if ok {
				return b
			}
		}
	}
	return false
}
