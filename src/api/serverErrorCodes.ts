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

/** Server returns this (HTTP 409) when a profile mutation (POST or PATCH
 *  /profiles) tries to land a name that already exists in the same scope
 *  for the same owner. Mapped from `profilestore.ErrConflict` via
 *  `storeErrorToHTTP` in internal/server/handlers_profiles_errors.go. */
export const CONFLICT = 'conflict' as const

/** Server returns this (HTTP 400) when a PATCH request body has no
 *  mutating fields (GAP-031 / #208). The SPA branches on this so it
 *  can render "no changes to save" instead of the raw 400 body --
 *  callers shouldn't treat empty_patch as a server-side failure. */
export const EMPTY_PATCH = 'empty_patch' as const
