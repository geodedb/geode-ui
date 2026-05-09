import type { ConnectionRecord, GeodeBridge } from '../types/electron'

export type { ConnectionRecord }

function bridge(): GeodeBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.geode
}

export function isElectron(): boolean {
  return bridge()?.isElectron === true
}

export async function getStoredConnections(): Promise<ConnectionRecord[]> {
  const b = bridge()
  if (!b) return []
  try {
    return await b.getStoredConnections()
  } catch {
    return []
  }
}

export async function storeConnections(
  list: ConnectionRecord[]
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.storeConnections(list)
  } catch {
    // best-effort; persistence failures must never block the SPA
  }
}

export async function getStoredPassword(
  profileName: string,
  username: string
): Promise<string | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.getStoredPassword(profileName, username)
  } catch {
    return null
  }
}

export async function storeSavedPassword(
  profileName: string,
  username: string,
  password: string
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.storeSavedPassword(profileName, username, password)
  } catch {
    // best-effort
  }
}

export async function clearStoredPassword(
  profileName: string,
  username: string
): Promise<void> {
  const b = bridge()
  if (!b) return
  try {
    await b.clearStoredPassword(profileName, username)
  } catch {
    // best-effort
  }
}

export async function pickPemFile(): Promise<string | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.pickPemFile()
  } catch {
    return null
  }
}
