package server

// Error-code taxonomy (GAP-Q23 / #126).
//
// Every error envelope emitted by this package — whether through the
// {error, error_description} JSON body (errorBody / endpointError.code),
// the WebSocket {kind:"error", code, message} frame (queryStreamMsg.Code),
// or via one of the envelope helpers (badRequest, writeBadRequest,
// writeEndpointErr, writeErr) — uses a `code` value that is part of the
// stable wire contract. The SPA renders the server's `error_description`
// verbatim for display; it additionally *branches* on a small subset of
// these codes (e.g. wire-feature-missing -> a clean "not supported by
// this build" message) -- those codes are mirrored in
// src/api/serverErrorCodes.ts and scripts/check-error-codes.mjs asserts
// the mirror stays in sync. External API consumers branch on these
// values too; renaming a code value is a breaking change.
//
// To keep that contract reviewable, every distinct `code` string lives
// here as a typed constant. errorcodes_test.go is a golden test that
// (a) fails if a handler introduces a literal error code without a
// constant here, and (b) fails if a constant here is never referenced
// (dead code). Adding a new error code therefore requires adding the
// constant in this file — the test enforces it.
//
// Codes are grouped by area. The string value of each constant is the
// exact byte sequence emitted on the wire; do not change it.
const (
	// --- generic / transport ---

	// ErrCodeProfileUnreachable: the connection pool could not produce a
	// *sql.DB for the request's connection profile (502).
	ErrCodeProfileUnreachable = "profile_unreachable"
	// ErrCodeInvalidParams: the request's `params` payload is not a valid
	// JSON object (400).
	ErrCodeInvalidParams = "invalid_params"
	// ErrCodeQueryError: a driver-level error executing a GQL statement
	// (422 over HTTP; surfaced as the WS error frame code too).
	ErrCodeQueryError = "query_error"
	// ErrCodeInternalError: unexpected internal failure (500). Distinct
	// from the WS "internal" frame code below.
	ErrCodeInternalError = "internal_error"
	// ErrCodeServerMisconfigured: the server is missing required
	// configuration (e.g. no auth signing key) for this endpoint (500).
	ErrCodeServerMisconfigured = "server_misconfigured"

	// --- auth ---

	// ErrCodeInvalidCredentials: username/password did not authenticate
	// (401). Constant value is byte-identical across every login-failure
	// mode (see errorBody doc / GAP-N10).
	ErrCodeInvalidCredentials = "invalid_credentials"
	// ErrCodeUnauthorized: a request hit a JWT-gated handler without a
	// valid bearer / cookie / access_token (401). Distinct from
	// ErrCodeInvalidCredentials because no login attempt was made — the
	// request never carried credentials in the first place. Used by
	// hand-rolled handlers that enforce AuthJWT themselves rather than
	// going through the genapi middleware chain.
	ErrCodeUnauthorized = "unauthorized"
	// ErrCodeInvalidRequest: malformed request body or invalid arguments
	// to an unauthenticated endpoint. Used by HandleOnboard and any future
	// pre-auth handlers; distinct from ErrCodeInvalidPassword (password-
	// policy violations) and ErrCodeForbidden (authorisation failures).
	ErrCodeInvalidRequest = "invalid_request"

	// --- password policy ---

	// ErrCodePasswordTooShort: candidate password is below the minimum
	// length (400).
	ErrCodePasswordTooShort = "password_too_short"
	// ErrCodePasswordTooWeak: candidate password failed the strength
	// estimator (400).
	ErrCodePasswordTooWeak = "password_too_weak"
	// ErrCodePasswordContainsUsername: candidate password contains the
	// account's username (400).
	ErrCodePasswordContainsUsername = "password_contains_username"
	// ErrCodePasswordPwned: candidate password appears in the breached
	// password corpus (400).
	ErrCodePasswordPwned = "password_pwned"
	// ErrCodePasswordPolicy: catch-all password-policy violation (400).
	ErrCodePasswordPolicy = "password_policy"

	// --- profile CRUD / profilestore ---

	// ErrCodeStoreDisabled: the profile store is not configured (503).
	ErrCodeStoreDisabled = "store_disabled"
	// ErrCodeNotFound: a requested profile does not exist — also used as
	// the visibility/permission cloak for personal profiles (404).
	ErrCodeNotFound = "not_found"
	// ErrCodeConflict: profile name already exists in this scope (409).
	ErrCodeConflict = "conflict"
	// ErrCodeImmutable: an immutable profile field (scope/owner) was
	// changed (400).
	ErrCodeImmutable = "immutable"
	// ErrCodeInvalid: generic profilestore validation failure (400).
	ErrCodeInvalid = "invalid"
	// ErrCodeForbidden: caller lacks the role required for this profile
	// scope, e.g. system profiles require admin (403).
	ErrCodeForbidden = "forbidden"
	// ErrCodeMissingID: the {profileId} path parameter was empty (400).
	ErrCodeMissingID = "missing_id"
	// ErrCodeInvalidScope: profile `scope` is not "system"/"personal" (400).
	ErrCodeInvalidScope = "invalid_scope"
	// ErrCodeInvalidTLS: the profile's TLS settings failed validation (400).
	ErrCodeInvalidTLS = "invalid_tls"
	// ErrCodeInvalidPoolOverrides: the profile's pool-override block
	// failed validation (400).
	ErrCodeInvalidPoolOverrides = "invalid_pool_overrides"

	// --- schema / catalog ---

	// ErrCodeSchemaError: a driver-level error running a catalog
	// statement (SHOW INDEXES / CONSTRAINTS / …) (422).
	ErrCodeSchemaError = "schema_error"

	// --- transactions ---

	// ErrCodeTxBeginFailed: opening a transaction on the upstream
	// failed (502).
	ErrCodeTxBeginFailed = "tx_begin_failed"
	// ErrCodeTxUseGraphFailed: the post-BEGIN "USE GRAPH" pin failed (502).
	ErrCodeTxUseGraphFailed = "tx_use_graph_failed"
	// ErrCodeTxNotFound: the referenced transaction handle is unknown or
	// expired (404).
	ErrCodeTxNotFound = "tx_not_found"
	// ErrCodeTxCommitFailed: COMMIT on the upstream failed (502).
	ErrCodeTxCommitFailed = "tx_commit_failed"
	// ErrCodeTxRollbackFailed: ROLLBACK on the upstream failed (502).
	ErrCodeTxRollbackFailed = "tx_rollback_failed"

	// --- uploads ---

	// ErrCodeUploadDisabled: file uploads are not enabled on this
	// server (403).
	ErrCodeUploadDisabled = "upload_disabled"
	// ErrCodeMissingFile: the multipart request had no `file` part (400).
	ErrCodeMissingFile = "missing_file"
	// ErrCodeInvalidFilename: the uploaded filename failed sanitisation
	// (path traversal / illegal chars) (400).
	ErrCodeInvalidFilename = "invalid_filename"
	// ErrCodeUploadDirFailed: creating the destination directory
	// failed (500).
	ErrCodeUploadDirFailed = "upload_dir_failed"
	// ErrCodeUploadOpenFailed: opening the destination temp file
	// failed (500).
	ErrCodeUploadOpenFailed = "upload_open_failed"
	// ErrCodeUploadWriteFailed: streaming the upload to disk failed (500).
	ErrCodeUploadWriteFailed = "upload_write_failed"
	// ErrCodeUploadCloseFailed: closing the destination temp file
	// failed (500).
	ErrCodeUploadCloseFailed = "upload_close_failed"
	// ErrCodeUploadRenameFailed: atomically renaming the temp file into
	// place failed (500).
	ErrCodeUploadRenameFailed = "upload_rename_failed"

	// --- audit ---

	// ErrCodeInvalidSince: the audit-log `since` query parameter is not a
	// valid timestamp (400).
	ErrCodeInvalidSince = "invalid_since"

	// --- admin RBAC: users / roles / policies / grants / migrations /
	//     backups. These mostly flow through badRequest(...) / wireErr. ---

	// ErrCodeUserAdminError: catch-all driver-level failure from a
	// wire-level admin statement (422). Stable code preserved across the
	// userResponseErr->respondErr rename.
	ErrCodeUserAdminError = "user_admin_error"
	// ErrCodeWireFeatureMissing: the connected Geode build does not
	// implement the requested wire verb (status_class=42000) (501).
	ErrCodeWireFeatureMissing = "wire_feature_missing"
	// ErrCodeUserNotFound: SHOW USER returned no rows (404).
	ErrCodeUserNotFound = "user_not_found"
	// ErrCodeRoleNotFound: SHOW ROLE returned no rows (404).
	ErrCodeRoleNotFound = "role_not_found"
	// ErrCodePolicyNotFound: SHOW POLICY returned no rows (404).
	ErrCodePolicyNotFound = "policy_not_found"
	// ErrCodeBackupNotFound: the referenced backup file is unknown (404).
	ErrCodeBackupNotFound = "backup_not_found"

	// ErrCodeInvalidEmail: a user email failed identifier/format
	// validation (400).
	ErrCodeInvalidEmail = "invalid_email"
	// ErrCodeInvalidPassword: a supplied password failed quoting/format
	// validation (400) — distinct from the password-policy codes.
	ErrCodeInvalidPassword = "invalid_password"
	// ErrCodeInvalidUsername: a username failed identifier validation (400).
	ErrCodeInvalidUsername = "invalid_username"
	// ErrCodeInvalidRole: a role name failed identifier validation (400).
	ErrCodeInvalidRole = "invalid_role"
	// ErrCodeInvalidPermission: a permission token failed validation (400).
	ErrCodeInvalidPermission = "invalid_permission"
	// ErrCodeInvalidDescription: a description string failed quoting
	// validation (400).
	ErrCodeInvalidDescription = "invalid_description"
	// ErrCodeInvalidPolicyName: a policy name failed identifier
	// validation (400).
	ErrCodeInvalidPolicyName = "invalid_policy_name"
	// ErrCodeInvalidExpression: a policy expression failed validation (400).
	ErrCodeInvalidExpression = "invalid_expression"
	// ErrCodeInvalidResource: a resource specifier failed quoting
	// validation (400).
	ErrCodeInvalidResource = "invalid_resource"
	// ErrCodeInvalidGrantee: a grantee name failed identifier
	// validation (400).
	ErrCodeInvalidGrantee = "invalid_grantee"
	// ErrCodeInvalidGranteeKind: grantee_kind is not "user"/"role" (400).
	ErrCodeInvalidGranteeKind = "invalid_grantee_kind"
	// ErrCodeInvalidName: a migration name failed identifier
	// validation (400).
	ErrCodeInvalidName = "invalid_name"
	// ErrCodeInvalidGraph: a graph name failed identifier validation (400).
	ErrCodeInvalidGraph = "invalid_graph"
	// ErrCodeInvalidOutput: a backup output path failed quoting
	// validation (400).
	ErrCodeInvalidOutput = "invalid_output"
	// ErrCodeInvalidFile: a backup file reference failed validation (400).
	ErrCodeInvalidFile = "invalid_file"
	// ErrCodeInvalidTargetTime: a restore target timestamp failed
	// validation (400).
	ErrCodeInvalidTargetTime = "invalid_target_time"
	// ErrCodeEmptyPatch: a PATCH request carried no mutating fields
	// (GAP-031 / #208). Distinct from invalid_params (which means a
	// malformed payload); empty_patch means "the payload was well-
	// formed but specified no change". The previous synthetic echo
	// path silently returned 200 with a fake User row; that misled
	// callers about server-side state.
	ErrCodeEmptyPatch = "empty_patch"

	// --- WebSocket query-stream error frames (queryStreamMsg.Code).
	//     These travel on the WS surface, not the JSON body envelope. ---

	// ErrCodeWSInternal: an internal failure on the WS stream path —
	// pool missing, codec error, etc.
	ErrCodeWSInternal = "internal"
	// ErrCodeWSBadRequest: the first WS frame was not a valid
	// kind=start with a non-empty statement.
	ErrCodeWSBadRequest = "bad_request"
	// ErrCodeWSScan: a row-scan failure mid-stream.
	ErrCodeWSScan = "scan"
	// ErrCodeWSCanceled: the stream was cancelled by the client.
	ErrCodeWSCanceled = "canceled"
)

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
	ErrCodeUnauthorized,
	ErrCodeInvalidRequest,
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
	ErrCodeEmptyPatch,
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
