// Server error-code string values the SPA branches on.
//
// The server's error-envelope `code` values are defined in
// internal/server/errorcodes.go (typed constants, e.g.
// `ErrCodeWireFeatureMissing = "wire_feature_missing"`). The SPA renders
// the server's `error_description` verbatim for display, but a couple of
// codes are *branched on* (e.g. wire-feature-missing -> render a clean
// "not supported by this Geode build" message instead of the raw 501
// body). Those codes are named here so there's one place coupled to the
// server contract -- and scripts/check-error-codes.mjs asserts every
// value in this file still exists in internal/server/errorcodes.go.
//
// Add a new entry here only when the SPA actually branches on a new
// server error code. Renaming a value is a breaking change on both sides.

/** Server returns this (HTTP 501) when the connected Geode build does not
 *  implement the requested DDL over the GQL wire. */
export const WIRE_FEATURE_MISSING = 'wire_feature_missing' as const
