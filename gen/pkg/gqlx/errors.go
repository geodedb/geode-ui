package gqlx

import "errors"

// Sentinel errors for GraphQL runtime. Kept at package level per repo
// conventions. Messages use a lowercase, package-prefixed, diagnostic
// form so log output reads naturally; errors.Is callers should rely on
// pointer equality rather than substring matching of Error().
var (
	ErrDepthExceeded      = errors.New("gqlx: query depth exceeds configured limit")
	ErrComplexityExceeded = errors.New("gqlx: query complexity exceeds configured limit")
	ErrAliasLimitExceeded = errors.New("gqlx: alias count exceeds configured limit")
	ErrIntrospection      = errors.New("gqlx: introspection disabled")
	ErrBatchLimitExceeded = errors.New("gqlx: batch size exceeds configured limit")
	ErrResolverTimeout    = errors.New("gqlx: resolver execution timed out")
	ErrFragmentCycle      = errors.New("gqlx: fragment cycle detected")
	ErrQueryTooLarge      = errors.New("gqlx: query body exceeds configured size")
	ErrAuthRequired       = errors.New("gqlx: authentication required")
	ErrRateLimited        = errors.New("gqlx: rate limit exceeded")
	ErrInvalidConfig      = errors.New("gqlx: invalid configuration")
	ErrFieldNotFound      = errors.New("gqlx: field not found in schema")
	ErrInvalidArgument    = errors.New("gqlx: invalid argument")
	ErrVariableNotDefined = errors.New("gqlx: variable referenced but not defined")
	ErrVariableUnused     = errors.New("gqlx: variable defined but not used")
)

// GQLError represents a single error in a GraphQL response per the spec.
type GQLError struct {
	Message    string         `json:"message"`
	Locations  []Location     `json:"locations,omitempty"`
	Path       []any          `json:"path,omitempty"`
	Extensions map[string]any `json:"extensions,omitempty"`
}

// Error implements the error interface.
func (e *GQLError) Error() string { return e.Message }

// Location identifies a position in the source query text.
type Location struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

// Response is the top-level JSON envelope for GraphQL responses.
type Response struct {
	Data   any         `json:"data"`
	Errors []*GQLError `json:"errors,omitempty"`
}
