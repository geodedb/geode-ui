package gqlx

import "errors"

// Sentinel errors for GraphQL runtime. Kept at package level per repo conventions.
var (
	ErrDepthExceeded      = errors.New("ErrDepthExceeded")
	ErrComplexityExceeded = errors.New("ErrComplexityExceeded")
	ErrAliasLimitExceeded = errors.New("ErrAliasLimitExceeded")
	ErrIntrospection      = errors.New("ErrIntrospection")
	ErrBatchLimitExceeded = errors.New("ErrBatchLimitExceeded")
	ErrResolverTimeout    = errors.New("ErrResolverTimeout")
	ErrFragmentCycle      = errors.New("ErrFragmentCycle")
	ErrQueryTooLarge      = errors.New("ErrQueryTooLarge")
	ErrAuthRequired       = errors.New("ErrAuthRequired")
	ErrRateLimited        = errors.New("ErrRateLimited")
	ErrInvalidConfig      = errors.New("ErrInvalidConfig")
	ErrFieldNotFound      = errors.New("ErrFieldNotFound")
	ErrInvalidArgument    = errors.New("ErrInvalidArgument")
	ErrVariableNotDefined = errors.New("ErrVariableNotDefined")
	ErrVariableUnused     = errors.New("ErrVariableUnused")
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
