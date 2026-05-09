# Profile System Rebuild — Overview

> **Decomposition note (per superpowers:writing-plans).** The user request — "rebuild the login and profile system so the full connection state of the app can be configured, allowing multiple geode instances/connections and full edit/modify of profiles" — covers five independent subsystems. Per the skill rule that *each plan must produce working, testable software on its own*, this overview indexes the sequence. **Each sub-plan lives in its own file and is executed independently.**

**Architecture decisions locked in (recorded so future plans don't have to re-litigate them):**

| Axis | Decision |
|---|---|
| Profile storage | **Hybrid** — server-managed `system` (admin) + server-scoped-per-user `personal` |
| Personal storage | **Server-scoped to authenticated user** (single source of truth for cross-device) |
| Sessions | **Multiple simultaneous Geode connections per user** |
| Wire auth | **Per-connection JWT in `Authorization: Bearer` header** (one token per active connection, SPA holds an in-memory map) |
| Targets | **Browser SPA + Electron** |
| Edit scope | **DSN, description, TLS material (PEM), pool tuning, saved username, default flag** |

**Implications.** Cookie-based auth is retained for backward compatibility but **multi-session uses Bearer headers exclusively** — the cookie path remains for the legacy single-session login. CSRF middleware continues to gate cookie-authenticated mutations; Bearer-authenticated mutations are exempt (no ambient authority to forge against).

---

## Sub-plan sequence and dependencies

```
A (server foundation) ──► B (multi-session auth) ──► C (SPA connection switcher) ──► D (SPA profile editor)
                                                                                         │
                                                                                         └──► E (Electron native bridge)
```

Each plan is independently shippable: A leaves the SPA UX unchanged but makes profiles dynamic; B leaves the SPA single-session but enables multi-session at the wire; C delivers multi-connection UX with a list-only profile picker; D adds full edit; E adds Electron-native polish.

| Plan | File | One-line goal | Depends on |
|---|---|---|---|
| **A** | `2026-05-09-profile-system-rebuild-A-server-foundation.md` | Replace boot-time JSON profiles with a SQLite-backed `internal/profilestore` and admin/owner-gated CRUD endpoints; `conn.Pool.Reload` lets the registered set change at runtime. | — |
| **B** | `2026-05-09-profile-system-rebuild-B-multi-session-auth.md` | Login response carries a `connection_id`; server accepts `Authorization: Bearer` for any authenticated endpoint and resolves the JWT's profile claim into the right pool entry; SPA gains a `ConnectionsContext` (in-memory map) but the UX still appears single-session. | A |
| **C** | `2026-05-09-profile-system-rebuild-C-spa-switcher.md` | Rebuild `LoginPage` as a profile-list picker; add a top-bar `ConnectionSwitcher`; every page (Query/Schema/Admin/Ops) reads the active connection via `useActiveConnection()`; "+ Add connection" opens a minimal create-profile form. | B |
| **D** | `2026-05-09-profile-system-rebuild-D-profile-editor.md` | Full ProfilesPage with create/edit/delete for `system` (admin) and `personal` (owner); TLS material upload-or-paste; pool tuning; saved username; default flag. | B (and ideally C for routing). |
| **E** | `2026-05-09-profile-system-rebuild-E-electron-native.md` | Electron preload exposes file-pick for TLS material, `safeStorage` persistence for tokens + saved passwords, auto-restore of connections on launch, OS keychain helpers. | D |

---

## What this overview is NOT

It is not a plan. The bite-sized tasks live in the per-plan files. Start with Plan A.

## Execution model

After Plan A completes, return here and ask for Plan B to be drafted in the same way. Plans are **drafted on demand**, not all up-front, so subsequent plans can incorporate what was learned implementing earlier ones.
