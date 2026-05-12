package server

import (
	"encoding/json/v2"
	"errors"
	"net/http"
	"strings"
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

// errorBody is the on-wire JSON shape every endpoint error serialises
// into. Defining it as a struct (rather than a map[string]any) keeps
// the key order deterministic — required by GAP-N10 so that the
// /auth/login failure path returns byte-identical responses across
// all failure modes regardless of Go's map-iteration randomisation.
type errorBody struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// writeEndpointError serialises an endpointError as JSON with the standard
// {error, error_description} shape used elsewhere in the platform.
func writeEndpointError(w http.ResponseWriter, e *endpointError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	_ = json.MarshalWrite(w, errorBody{
		Error:            e.code,
		ErrorDescription: e.description,
	})
}

// writeEndpointErr is the boilerplate-free callsite helper for the
// dozens of handler call sites that inline an &endpointError{...}
// literal into writeEndpointError. Pure refactor; equivalent to
// `writeEndpointError(w, &endpointError{status: status, code: code,
// description: msg})`.
//
// GAP-Q07 (#98): introduced to collapse ~20 callsites in
// handlers_profiles_crud.go (and twins elsewhere) from a 5-line
// struct-literal block into a single call. Validators stay pure
// (per E2 hand-off note for S10) — this helper does NOT do PEM or
// other input validation, only the error-write boilerplate.
func writeEndpointErr(w http.ResponseWriter, status int, code, msg string) {
	writeEndpointError(w, &endpointError{
		status:      status,
		code:        code,
		description: msg,
	})
}

// writeStoreUnavailable is a named convenience for the recurring
// "store not configured" 503 used by every CRUD handler when
// s.cfg.Store is nil. Same shape across PostProfiles / GetProfileid /
// PatchProfileid / DeleteProfileid.
func writeStoreUnavailable(w http.ResponseWriter) {
	writeEndpointErr(w, http.StatusServiceUnavailable,
		ErrCodeStoreDisabled, "profile store not configured")
}

// writeBadRequest is a named convenience for the recurring 400 +
// stable code shape used by validation early-returns in CRUD
// handlers. Equivalent to writeEndpointErr with
// http.StatusBadRequest.
func writeBadRequest(w http.ResponseWriter, code, msg string) {
	writeEndpointErr(w, http.StatusBadRequest, code, msg)
}

// writeNotFound is a named convenience for the recurring 404 +
// "profile not found" pattern used by both the visibility cloak
// (returning 404 instead of 403 for a personal profile owned by
// someone else) and the canMutate cloak in PATCH/DELETE.
func writeNotFound(w http.ResponseWriter, msg string) {
	writeEndpointErr(w, http.StatusNotFound, ErrCodeNotFound, msg)
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

// errWireFeatureMissing is the sentinel that callers can wrap (via
// fmt.Errorf("...: %w", errWireFeatureMissing)) to flag a wire-level
// "this verb isn't recognized by the server" condition explicitly.
// `isWireFeatureMissing` checks for it first via errors.Is, before
// falling back to interface- and substring-based detection on
// driver-emitted errors.
//
// GAP-Q6 (#36): introduced so call sites that *know* they should
// degrade gracefully can do so unambiguously without relying on the
// driver's free-form text.
var errWireFeatureMissing = errors.New("server: wire feature not implemented on this geode build")

// wireFeatureMissingSubstrings is the pinned list of accepted
// fallback substrings used by isWireFeatureMissing when no typed
// signal is available. Tests in errors_test.go pin every entry so
// the wire-degradation behaviour cannot drift silently when a
// driver upstream changes its error wording. Adding a new entry
// requires both a code change here AND an explicit test row.
var wireFeatureMissingSubstrings = []string{
	"parse error",
	"expected token",
	"expected identifier",
}

// isWireFeatureMissing reports whether err looks like a parse error from
// the upstream Geode — i.e. the engine doesn't recognize the GQL syntax
// at all on this version of the wire. Several admin reads (SHOW USERS /
// ROLES / POLICIES / BACKUPS / MIGRATIONS) trip this on Geode v0.5.11
// because the catalog DDL hasn't shipped on the wire yet. Read handlers
// use this to degrade gracefully to an empty list (HTTP 200) rather
// than surfacing a 422 to the UI on every page load.
//
// Detection order (post-Q6 / #36):
//  1. errors.Is(err, errWireFeatureMissing) — explicit sentinel wrap.
//  2. errors.As against the statusClasser interface — drivers that
//     expose a typed StatusClass() return "42000" for parse errors.
//  3. Substring fallback — older drivers wrap the wire status class
//     into the bare error text. Accepted substrings are PINNED in
//     `wireFeatureMissingSubstrings` and exercised by errors_test.go
//     so a silent driver-message drift cannot widen the predicate.
func isWireFeatureMissing(err error) bool {
	if err == nil {
		return false
	}
	// 1: explicit sentinel — handlers that already know the upstream
	// returned "verb not implemented" can wrap with %w to short-circuit
	// the substring guess work.
	if errors.Is(err, errWireFeatureMissing) {
		return true
	}
	// 2: typed StatusClass — driver-supplied 42000 reading.
	type statusClasser interface{ StatusClass() string }
	var sc statusClasser
	if errors.As(err, &sc) && sc.StatusClass() == "42000" {
		return true
	}
	// 3: substring fallback — drivers that don't expose StatusClass()
	// (or wrap the err in a way that loses it) still embed the
	// canonical `<class>: <message>` shape in the error text. Both
	// signals (42000 + a message-shape substring) must be present so
	// an unrelated 42000-mentioning string cannot accidentally trigger.
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "42000") {
		return false
	}
	for _, sub := range wireFeatureMissingSubstrings {
		if strings.Contains(msg, sub) {
			return true
		}
	}
	return false
}

// badRequest is a small helper for 400 endpointErrors emitted from
// validation failures inside the user/role/policy/grant/backup/migration
// handlers.
func badRequest(code, desc string) error {
	return &endpointError{status: http.StatusBadRequest, code: code, description: desc}
}

// respondErr is the catch-all wire-handlers analogue of
// schemaResponseErr — inline-writes endpoint errors and returns nil so
// the wrapper does not emit a second body, and passes through
// non-endpoint errors as-is so they surface as 500.
//
// Used by every wire-level handler family (users, roles, policies,
// grants, backups, migrations) — the legacy `userResponseErr` name
// was a misnomer once the helper landed outside the user-admin path.
func respondErr(w http.ResponseWriter, err error) error {
	if ep := asEndpointError(err); ep != nil {
		writeEndpointError(w, ep)
		return nil
	}
	return err
}

// wireErr wraps a driver-level error from any wire-level admin
// statement (users / roles / policies / grants / backups / migrations)
// as a 422 endpointError with code=user_admin_error so the client gets
// a stable code distinct from auth/transport failures.
//
// When the upstream returns the canonical "engine doesn't recognize
// this verb" signal (status_class=42000 + parse-error tokens), upgrade
// the response to a 501 wire_feature_missing with a clear description.
// That tells the SPA "this operation cannot be performed on this Geode
// version" — distinct from "your input was bad" — and lets it surface
// a friendlier message than raw "geode: 42000: parse error".
//
// The stable response `code` (`user_admin_error`) is preserved across
// the rename for client-API compatibility; it is a body field, not a
// helper name.
func wireErr(err error) error {
	if err == nil {
		return nil
	}
	if isWireFeatureMissing(err) {
		return &endpointError{
			status:      http.StatusNotImplemented,
			code:        ErrCodeWireFeatureMissing,
			description: "this operation is not supported on the connected Geode build (status_class=42000); the SPA may have surfaced this CTA prematurely",
		}
	}
	return &endpointError{
		status:      http.StatusUnprocessableEntity,
		code:        ErrCodeUserAdminError,
		description: err.Error(),
	}
}
