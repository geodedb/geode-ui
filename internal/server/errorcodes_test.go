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
	files := parseNonTestFiles(t, fset)
	constValue := collectErrCodeConsts(t, files)
	checkGoldenSetMirrorsConsts(t, constValue)
	usageCount := scanErrorCodeUsages(t, fset, files, errorCodeSet)
	for name := range constValue {
		if usageCount[name] == 0 {
			t.Errorf("ErrCode* constant %s is never referenced — dead code", name)
		}
	}
}

// parseNonTestFiles parses every non-test .go file in the package dir.
// Test files are skipped: steady-state tests shouldn't constrain
// test-only literals, and a planted-straggler verification lives in a
// throwaway branch during development.
func parseNonTestFiles(t *testing.T, fset *token.FileSet) []*ast.File {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	var files []*ast.File
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
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
	return files
}

// collectErrCodeConsts returns every ErrCode* constant name mapped to its
// string value.
func collectErrCodeConsts(t *testing.T, files []*ast.File) map[string]string {
	t.Helper()
	constValue := map[string]string{}
	for _, file := range files {
		ast.Inspect(file, func(n ast.Node) bool {
			gd, ok := n.(*ast.GenDecl)
			if !ok || gd.Tok != token.CONST {
				return true
			}
			for _, spec := range gd.Specs {
				if vs, ok := spec.(*ast.ValueSpec); ok {
					collectErrCodeSpec(t, vs, constValue)
				}
			}
			return true
		})
	}
	if len(constValue) == 0 {
		t.Fatal("no ErrCode* constants found — errorcodes.go missing?")
	}
	return constValue
}

// collectErrCodeSpec records the ErrCode* names declared by one const spec.
func collectErrCodeSpec(t *testing.T, vs *ast.ValueSpec, constValue map[string]string) {
	t.Helper()
	for i, name := range vs.Names {
		if !strings.HasPrefix(name.Name, "ErrCode") || i >= len(vs.Values) {
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

// checkGoldenSetMirrorsConsts asserts allErrorCodes mirrors the const
// block exactly (values, and count) so it stays a faithful golden set.
func checkGoldenSetMirrorsConsts(t *testing.T, constValue map[string]string) {
	t.Helper()
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
}

// scanErrorCodeUsages walks the package source, reports every string
// literal in an error-envelope code position, and returns how often each
// ErrCode* identifier is referenced outside its own declaration.
func scanErrorCodeUsages(
	t *testing.T, fset *token.FileSet, files []*ast.File, validValues map[string]struct{},
) map[string]int {
	t.Helper()
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
					if kv, ok := elt.(*ast.KeyValueExpr); ok && isCodeKey(kv.Key) {
						checkCodeLiteral(t, fset, fname, "", kv.Value, validValues)
					}
				}
			case *ast.CallExpr:
				name := calleeName(x.Fun)
				if argIdx, isHelper := helperCodeArg[name]; isHelper && argIdx < len(x.Args) {
					checkCodeLiteral(t, fset, fname, name, x.Args[argIdx], validValues)
				}
			}
			return true
		})
	}
	return usageCount
}

// isCodeKey reports whether a composite-literal key is a `code`/`Code` field.
func isCodeKey(key ast.Expr) bool {
	id, ok := key.(*ast.Ident)
	return ok && (id.Name == "code" || id.Name == "Code")
}

// checkCodeLiteral reports expr when it is a string literal in an error
// code position. helper is the envelope helper's name, or "" for a
// composite-literal field.
func checkCodeLiteral(
	t *testing.T, fset *token.FileSet, fname, helper string, expr ast.Expr, validValues map[string]struct{},
) {
	t.Helper()
	bl, ok := expr.(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return
	}
	v, _ := strconv.Unquote(bl.Value)
	line := fset.Position(bl.Pos()).Line
	where := ""
	if helper != "" {
		where = helper + "(...) "
	}
	if _, ok := validValues[v]; !ok {
		t.Errorf("%s:%d: %serror code literal %q not declared as an ErrCode* constant in errorcodes.go",
			fname, line, where, v)
	} else {
		t.Errorf("%s:%d: %serror code literal %q should use the ErrCode* constant, not a string literal",
			fname, line, where, v)
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

// allErrorCodes lists every ErrCode* constant in this file. errorcodes_test.go
// uses it as the golden set: every literal error code in the package's
// source must be present here, and every entry here must be referenced.
//
// Keep this in sync with the const block above (the test will fail loudly
// if a constant is missing from this slice).
var allErrorCodes = []string{
	ErrCodeProfileUnreachable,
	ErrCodeInvalidParams,
	ErrCodeQueryError,
	ErrCodeInternalError,
	ErrCodeServerMisconfigured,
	ErrCodeInvalidCredentials,
	ErrCodeRateLimited,
	ErrCodePasswordTooShort,
	ErrCodePasswordTooWeak,
	ErrCodePasswordContainsUsername,
	ErrCodePasswordPwned,
	ErrCodePasswordPolicy,
	ErrCodeStoreDisabled,
	ErrCodeNotFound,
	ErrCodeConflict,
	ErrCodeImmutable,
	ErrCodeInvalid,
	ErrCodeForbidden,
	ErrCodeMissingID,
	ErrCodeInvalidScope,
	ErrCodeInvalidTLS,
	ErrCodeInvalidPoolOverrides,
	ErrCodeSchemaError,
	ErrCodeTxBeginFailed,
	ErrCodeTxUseGraphFailed,
	ErrCodeTxNotFound,
	ErrCodeTxCommitFailed,
	ErrCodeTxRollbackFailed,
	ErrCodeUploadDisabled,
	ErrCodeMissingFile,
	ErrCodeInvalidFilename,
	ErrCodeUploadDirFailed,
	ErrCodeUploadOpenFailed,
	ErrCodeUploadWriteFailed,
	ErrCodeUploadCloseFailed,
	ErrCodeUploadRenameFailed,
	ErrCodeInvalidSince,
	ErrCodeUserAdminError,
	ErrCodeWireFeatureMissing,
	ErrCodeUserNotFound,
	ErrCodeRoleNotFound,
	ErrCodePolicyNotFound,
	ErrCodeBackupNotFound,
	ErrCodeInvalidEmail,
	ErrCodeInvalidPassword,
	ErrCodeInvalidUsername,
	ErrCodeInvalidRole,
	ErrCodeInvalidPermission,
	ErrCodeInvalidDescription,
	ErrCodeInvalidPolicyName,
	ErrCodeInvalidExpression,
	ErrCodeInvalidResource,
	ErrCodeInvalidGrantee,
	ErrCodeInvalidGranteeKind,
	ErrCodeInvalidName,
	ErrCodeInvalidGraph,
	ErrCodeInvalidOutput,
	ErrCodeInvalidFile,
	ErrCodeInvalidTargetTime,
	ErrCodeWSInternal,
	ErrCodeWSBadRequest,
	ErrCodeWSScan,
	ErrCodeWSCanceled,
}

// errorCodeSet is allErrorCodes as a set for O(1) membership checks in
// the golden test and any future runtime validation.
var errorCodeSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(allErrorCodes))
	for _, c := range allErrorCodes {
		m[c] = struct{}{}
	}
	return m
}()
