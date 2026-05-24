import { runProcedure, asString } from './queryRunner'

// Per-user ABAC attribute store wrappers (Geode 0.5.20).
// Backend procedures live in geode/src/execution/auth_dispatch.zig
// (lines 675-722) and the in-memory store at
// geode/src/security/user_attribute_store.zig.
//
// listUserAttributes probes the optional
// `geode.auth.user_list_attributes` procedure: on builds without it
// (HTTP 501 / wire_feature_missing) the wrapper returns [] so the UI
// can fall back to the per-session in-memory mirror of set/remove
// calls.

export interface UserAttribute {
  key: string
  value: string
}

export async function setUserAttribute(
  username: string,
  key: string,
  value: string
): Promise<void> {
  if (!username) throw new Error('username required')
  if (!key) throw new Error('key required')
  await runProcedure('geode.auth.user_set_attribute', [username, key, value])
}

export async function removeUserAttribute(
  username: string,
  key: string
): Promise<void> {
  if (!username) throw new Error('username required')
  if (!key) throw new Error('key required')
  await runProcedure('geode.auth.user_remove_attribute', [username, key])
}

export async function listUserAttributes(
  username: string
): Promise<UserAttribute[]> {
  if (!username) return []
  try {
    const r = await runProcedure('geode.auth.user_list_attributes', [username])
    return r.rows
      .map((row) => ({
        key: asString(row.key) ?? '',
        value: asString(row.value) ?? '',
      }))
      .filter((a) => a.key.length > 0)
  } catch (err) {
    const e = err as { status?: number }
    if (e?.status === 501) return []
    throw err
  }
}
