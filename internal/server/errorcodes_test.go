package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestErrorCodeTaxonomy is the golden test for GAP-Q23 / #126.
//
// Approach (AST walk over the package source, dep-free — go/parser +
// go/ast over each .go file in "."; we parse files individually rather
// than via the deprecated parser.ParseDir):
//
//  1. Find every string literal that flows into an error-envelope `code`
//     position:
//     - the `code:` / `Code:` field of a composite literal (covers
//     endpointError{...}, queryStreamMsg{...}, errorBody-via-helper);
//     - the `code` argument of the envelope helper funcs:
//     badRequest(code, ...)                  arg 0
//     writeBadRequest(w, code, ...)          arg 1
//     writeEndpointErr(w, status, code, ...) arg 2
//     writeErr(conn, code, ...)              arg 1
//  2. Assert every such literal is one of the ErrCode* constants
//     (i.e. nothing escaped the migration to errorcodes.go).
//  3. Assert every entry in allErrorCodes (== every ErrCode* constant)
//     is referenced somewhere in the package source (no dead constants).
//
// The migration replaces every literal with an ErrCode* identifier, so
// in the steady state step (2) sees *no* string literals at all in those
// positions — but the test still catches a regression: if someone adds a
// new literal error code without a constant, step (2) flags it. The test
// was verified against a deliberately-planted straggler literal before
// being trusted (see commit message for GAP-Q23).
func TestErrorCodeTaxonomy(t *testing.T) {
	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	var files []*ast.File
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			// Skip test files: steady-state tests shouldn't constrain
			// test-only literals, and a planted-straggler verification
			// lives in a throwaway branch during development.
			continue
		}
		f, perr := parser.ParseFile(fset, name, nil, 0)
		if perr != nil {
			t.Fatalf("parse %s: %v", name, perr)
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		t.Fatal("no non-test .go files found in package dir")
	}

	// Build the set of ErrCode* constant names + their string values.
	constValue := map[string]string{}
	for _, file := range files {
		ast.Inspect(file, func(n ast.Node) bool {
			gd, ok := n.(*ast.GenDecl)
			if !ok || gd.Tok != token.CONST {
				return true
			}
			for _, spec := range gd.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range vs.Names {
					if !strings.HasPrefix(name.Name, "ErrCode") {
						continue
					}
					if i >= len(vs.Values) {
						continue
					}
					bl, ok := vs.Values[i].(*ast.BasicLit)
					if !ok || bl.Kind != token.STRING {
						t.Errorf("const %s is not a plain string literal", name.Name)
						continue
					}
					v, uerr := strconv.Unquote(bl.Value)
					if uerr != nil {
						t.Errorf("const %s value unparsable: %v", name.Name, uerr)
						continue
					}
					constValue[name.Name] = v
				}
			}
			return true
		})
	}
	if len(constValue) == 0 {
		t.Fatal("no ErrCode* constants found — errorcodes.go missing?")
	}

	// Sanity: allErrorCodes mirrors the const block exactly (values, and
	// count) so it stays a faithful golden set.
	byValue := map[string]string{}
	for name, v := range constValue {
		if other, dup := byValue[v]; dup {
			t.Errorf("error code value %q bound to two constants: %s and %s", v, other, name)
		}
		byValue[v] = name
	}
	for _, v := range allErrorCodes {
		if _, ok := byValue[v]; !ok {
			t.Errorf("allErrorCodes lists %q but no ErrCode* constant has that value", v)
		}
	}
	if len(allErrorCodes) != len(constValue) {
		t.Errorf("allErrorCodes has %d entries but %d ErrCode* constants exist — keep them in sync",
			len(allErrorCodes), len(constValue))
	}

	validValues := errorCodeSet

	// helperCodeArg maps an envelope-helper func name to the argument
	// index that carries the error code.
	helperCodeArg := map[string]int{
		"badRequest":       0,
		"writeBadRequest":  1,
		"writeEndpointErr": 2,
		"writeErr":         1,
	}

	usageCount := map[string]int{}
	for _, file := range files {
		fname := filepath.Base(fset.File(file.Pos()).Name())
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.GenDecl:
				// Don't count the const declaration's own name idents
				// toward "referenced".
				if x.Tok == token.CONST {
					return false
				}
			case *ast.Ident:
				if strings.HasPrefix(x.Name, "ErrCode") {
					usageCount[x.Name]++
				}
			case *ast.CompositeLit:
				for _, elt := range x.Elts {
					kv, ok := elt.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					key, ok := kv.Key.(*ast.Ident)
					if !ok || (key.Name != "code" && key.Name != "Code") {
						continue
					}
					if bl, ok := kv.Value.(*ast.BasicLit); ok && bl.Kind == token.STRING {
						v, _ := strconv.Unquote(bl.Value)
						pos := fset.Position(bl.Pos())
						if _, ok := validValues[v]; !ok {
							t.Errorf("%s:%d: error code literal %q not declared as an ErrCode* constant in errorcodes.go", fname, pos.Line, v)
						} else {
							t.Errorf("%s:%d: error code literal %q should use the ErrCode* constant, not a string literal", fname, pos.Line, v)
						}
					}
				}
			case *ast.CallExpr:
				name := calleeName(x.Fun)
				argIdx, isHelper := helperCodeArg[name]
				if !isHelper || argIdx >= len(x.Args) {
					return true
				}
				if bl, ok := x.Args[argIdx].(*ast.BasicLit); ok && bl.Kind == token.STRING {
					v, _ := strconv.Unquote(bl.Value)
					pos := fset.Position(bl.Pos())
					if _, ok := validValues[v]; !ok {
						t.Errorf("%s:%d: %s(...) error code literal %q not declared as an ErrCode* constant in errorcodes.go", fname, pos.Line, name, v)
					} else {
						t.Errorf("%s:%d: %s(...) error code literal %q should use the ErrCode* constant, not a string literal", fname, pos.Line, name, v)
					}
				}
			}
			return true
		})
	}

	for name := range constValue {
		if usageCount[name] == 0 {
			t.Errorf("ErrCode* constant %s is never referenced — dead code", name)
		}
	}
}

// calleeName returns the trailing identifier of a call's Fun expression,
// handling both bare identifiers (badRequest) and selector exprs.
func calleeName(fun ast.Expr) string {
	switch f := fun.(type) {
	case *ast.Ident:
		return f.Name
	case *ast.SelectorExpr:
		return f.Sel.Name
	}
	return ""
}
