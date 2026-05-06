package gqlx

import "fmt"

// ValidateOptions controls the security limits enforced during validation.
type ValidateOptions struct {
	MaxDepth      int
	MaxComplexity int
	MaxAliases    int
}

// Validate checks a parsed GraphQL document against a schema for security
// and correctness. It validates all operations in the document.
func Validate(doc *Document, schema *Schema, opts ValidateOptions) error {
	v := &validator{
		doc:    doc,
		schema: schema,
		opts:   opts,
	}

	// Build fragment map for lookups.
	v.fragMap = make(map[string]*FragmentDef, len(doc.Fragments))
	for _, frag := range doc.Fragments {
		v.fragMap[frag.Name] = frag
	}

	// Check for fragment cycles first (independent of operations).
	if err := v.checkFragmentCycles(); err != nil {
		return err
	}

	// Validate each operation.
	for _, op := range doc.Operations {
		parentType := v.rootType(op.Type)
		if parentType == nil {
			continue
		}

		// Depth check.
		if opts.MaxDepth > 0 {
			if err := v.checkDepth(op.Selections, 1, opts.MaxDepth); err != nil {
				return err
			}
		}

		// Complexity check.
		if opts.MaxComplexity > 0 {
			cost, err := v.checkComplexity(op.Selections, parentType)
			if err != nil {
				return err
			}
			if cost > opts.MaxComplexity {
				return fmt.Errorf("query complexity %d exceeds limit %d: %w",
					cost, opts.MaxComplexity, ErrComplexityExceeded)
			}
		}

		// Alias limit check.
		if opts.MaxAliases > 0 {
			count := v.countAliases(op.Selections)
			if count > opts.MaxAliases {
				return fmt.Errorf("alias count %d exceeds limit %d: %w",
					count, opts.MaxAliases, ErrAliasLimitExceeded)
			}
		}

		// Field existence and argument checks.
		if err := v.checkFields(op.Selections, parentType); err != nil {
			return err
		}

		// Variable checks.
		if err := v.checkVariables(op); err != nil {
			return err
		}
	}

	return nil
}

// validator holds state for a single validation pass.
type validator struct {
	doc     *Document
	schema  *Schema
	opts    ValidateOptions
	fragMap map[string]*FragmentDef
}

// rootType returns the ObjectType for the given operation kind.
func (v *validator) rootType(opType OperationType) *ObjectType {
	switch opType {
	case OperationQuery:
		return v.schema.Query
	case OperationMutation:
		return v.schema.Mutation
	case OperationSubscription:
		return v.schema.Subscription
	default:
		return v.schema.Query
	}
}

// checkFragmentCycles performs DFS over fragment spreads to detect cycles.
func (v *validator) checkFragmentCycles() error {
	// Track global visited state: 0 = unvisited, 1 = in-stack, 2 = done
	state := make(map[string]int, len(v.fragMap))
	for name := range v.fragMap {
		state[name] = 0
	}

	for name := range v.fragMap {
		if state[name] == 0 {
			if err := v.dfsFragment(name, state); err != nil {
				return err
			}
		}
	}
	return nil
}

// dfsFragment recursively walks fragment spreads detecting back edges.
func (v *validator) dfsFragment(name string, state map[string]int) error {
	state[name] = 1 // in-stack

	frag, ok := v.fragMap[name]
	if !ok {
		state[name] = 2
		return nil
	}

	refs := v.collectFragmentSpreads(frag.Selections)
	for _, ref := range refs {
		switch state[ref] {
		case 1:
			// Back edge — cycle detected.
			return fmt.Errorf("fragment %q forms a cycle: %w", ref, ErrFragmentCycle)
		case 0:
			if err := v.dfsFragment(ref, state); err != nil {
				return err
			}
		}
	}

	state[name] = 2 // done
	return nil
}

// collectFragmentSpreads walks selections and returns all fragment spread names.
func (v *validator) collectFragmentSpreads(selections []Selection) []string {
	var names []string
	for _, sel := range selections {
		switch s := sel.(type) {
		case *FragmentSpread:
			names = append(names, s.Name)
		case *Field:
			names = append(names, v.collectFragmentSpreads(s.Selections)...)
		case *InlineFragment:
			names = append(names, v.collectFragmentSpreads(s.Selections)...)
		}
	}
	return names
}

// checkDepth recursively walks selections counting nesting depth.
func (v *validator) checkDepth(selections []Selection, currentDepth, maxDepth int) error {
	if currentDepth > maxDepth {
		return fmt.Errorf("query depth %d exceeds limit %d: %w",
			currentDepth, maxDepth, ErrDepthExceeded)
	}

	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			if len(s.Selections) > 0 {
				if err := v.checkDepth(s.Selections, currentDepth+1, maxDepth); err != nil {
					return err
				}
			}
		case *InlineFragment:
			if err := v.checkDepth(s.Selections, currentDepth, maxDepth); err != nil {
				return err
			}
		case *FragmentSpread:
			if frag, ok := v.fragMap[s.Name]; ok {
				if err := v.checkDepth(frag.Selections, currentDepth, maxDepth); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// checkComplexity recursively computes the cost of a selection set.
// Each field costs 1. If a field's type is a ListType, child cost is
// multiplied by 10.
func (v *validator) checkComplexity(selections []Selection, parentType *ObjectType) (int, error) {
	total := 0
	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			// __typename is a built-in meta field, costs 1.
			if s.Name == "__typename" {
				total++
				continue
			}

			fieldDef, ok := parentType.Field(s.Name)
			if !ok {
				// Field validation will catch this; just add base cost.
				total++
				continue
			}

			cost := 1
			if len(s.Selections) > 0 {
				objType := v.resolveObjectType(fieldDef.Type)
				if objType != nil {
					childCost, err := v.checkComplexity(s.Selections, objType)
					if err != nil {
						return 0, err
					}
					multiplier := 1
					if v.isList(fieldDef.Type) {
						multiplier = 10
					}
					cost += childCost * multiplier
				}
			}
			total += cost

		case *InlineFragment:
			childCost, err := v.checkComplexity(s.Selections, parentType)
			if err != nil {
				return 0, err
			}
			total += childCost

		case *FragmentSpread:
			if frag, ok := v.fragMap[s.Name]; ok {
				childCost, err := v.checkComplexity(frag.Selections, parentType)
				if err != nil {
					return 0, err
				}
				total += childCost
			}
		}
	}
	return total, nil
}

// isList returns true if the type (after unwrapping NonNull) is a ListType.
func (v *validator) isList(t GQLType) bool {
	for {
		switch tt := t.(type) {
		case *ListType:
			return true
		case *NonNullType:
			t = tt.Elem
		default:
			return false
		}
	}
}

// resolveObjectType unwraps List/NonNull wrappers to find the underlying
// ObjectType, or returns nil if the base type is a scalar.
func (v *validator) resolveObjectType(t GQLType) *ObjectType {
	for {
		switch tt := t.(type) {
		case *ObjectType:
			return tt
		case *ListType:
			t = tt.Elem
		case *NonNullType:
			t = tt.Elem
		default:
			return nil
		}
	}
}

// countAliases recursively counts fields with non-empty Alias.
func (v *validator) countAliases(selections []Selection) int {
	count := 0
	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			if s.Alias != "" {
				count++
			}
			count += v.countAliases(s.Selections)
		case *InlineFragment:
			count += v.countAliases(s.Selections)
		case *FragmentSpread:
			if frag, ok := v.fragMap[s.Name]; ok {
				count += v.countAliases(frag.Selections)
			}
		}
	}
	return count
}

// checkFields validates that each field exists on its parent type and that
// required arguments are provided.
func (v *validator) checkFields(selections []Selection, parentType *ObjectType) error {
	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			// __typename is valid on any object type.
			if s.Name == "__typename" {
				continue
			}

			fieldDef, ok := parentType.Field(s.Name)
			if !ok {
				return fmt.Errorf("field %q not found on type %q: %w",
					s.Name, parentType.TypeName(), ErrFieldNotFound)
			}

			// Check required arguments.
			if err := v.checkArgs(s, fieldDef); err != nil {
				return err
			}

			// Recurse into nested selections.
			if len(s.Selections) > 0 {
				objType := v.resolveObjectType(fieldDef.Type)
				if objType != nil {
					if err := v.checkFields(s.Selections, objType); err != nil {
						return err
					}
				}
			}

		case *InlineFragment:
			if err := v.checkFields(s.Selections, parentType); err != nil {
				return err
			}

		case *FragmentSpread:
			if frag, ok := v.fragMap[s.Name]; ok {
				if err := v.checkFields(frag.Selections, parentType); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// checkArgs validates that all required arguments are provided for a field.
func (v *validator) checkArgs(field *Field, fieldDef FieldDef) error {
	// Build a set of provided argument names.
	provided := make(map[string]bool, len(field.Arguments))
	for _, arg := range field.Arguments {
		provided[arg.Name] = true
	}

	for _, argDef := range fieldDef.Args {
		if argDef.Required && !provided[argDef.Name] {
			return fmt.Errorf("required argument %q missing on field %q: %w",
				argDef.Name, field.Name, ErrInvalidArgument)
		}
	}
	return nil
}

// checkVariables validates that all declared variables are used and all
// used variables are declared.
func (v *validator) checkVariables(op *Operation) error {
	// Collect declared variable names.
	declared := make(map[string]bool, len(op.Variables))
	for _, vd := range op.Variables {
		declared[vd.Name] = true
	}

	// Collect used variable names from the selection set.
	used := make(map[string]bool)
	v.collectUsedVars(op.Selections, used)

	// Check for used but not declared.
	for name := range used {
		if !declared[name] {
			return fmt.Errorf("variable %q is used but not defined: %w",
				name, ErrVariableNotDefined)
		}
	}

	// Check for declared but not used.
	for name := range declared {
		if !used[name] {
			return fmt.Errorf("variable %q is declared but not used: %w",
				name, ErrVariableUnused)
		}
	}

	return nil
}

// collectUsedVars walks selections recursively to find all VariableValue
// references.
func (v *validator) collectUsedVars(selections []Selection, used map[string]bool) {
	for _, sel := range selections {
		switch s := sel.(type) {
		case *Field:
			for _, arg := range s.Arguments {
				v.collectUsedVarsFromValue(arg.Value, used)
			}
			v.collectUsedVars(s.Selections, used)
		case *InlineFragment:
			v.collectUsedVars(s.Selections, used)
		case *FragmentSpread:
			if frag, ok := v.fragMap[s.Name]; ok {
				v.collectUsedVars(frag.Selections, used)
			}
		}
	}
}

// collectUsedVarsFromValue recursively extracts variable references from
// a value node.
func (v *validator) collectUsedVarsFromValue(val Value, used map[string]bool) {
	switch vv := val.(type) {
	case *VariableValue:
		used[vv.Name] = true
	case *ListValue:
		for _, elem := range vv.Values {
			v.collectUsedVarsFromValue(elem, used)
		}
	case *ObjectValue:
		for _, f := range vv.Fields {
			v.collectUsedVarsFromValue(f.Value, used)
		}
	}
}
