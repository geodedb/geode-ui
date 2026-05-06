package server

import (
	"encoding/json/v2"
	"errors"
	"net/http"
)

// endpointError is a structured handler error that carries both an HTTP
// status and an OAuth-style code/description. The query handler returns
// these wrapped in an error so generic genapi machinery can keep its
// "return nil error or 500" contract while still letting handlers emit
// 4xx responses with stable codes.
type endpointError struct {
	status      int
	code        string
	description string
}

func (e *endpointError) Error() string { return e.code + ": " + e.description }

// writeEndpointError serialises an endpointError as JSON with the standard
// {error, error_description} shape used elsewhere in the platform.
func writeEndpointError(w http.ResponseWriter, e *endpointError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	_ = json.MarshalWrite(w, map[string]any{
		"error":             e.code,
		"error_description": e.description,
	})
}

// asEndpointError extracts an *endpointError from err if it is one (or wraps
// one), otherwise returns nil.
func asEndpointError(err error) *endpointError {
	var ep *endpointError
	if errors.As(err, &ep) {
		return ep
	}
	return nil
}
