import {
  isElectron,
  getStoredConnections,
  storeConnections,
  getStoredPassword,
  storeSavedPassword,
  clearStoredPassword,
  pickPemFile,
} from './electron-bridge'
import type { GeodeBridge } from '../types/electron'

afterEach(() => {
  delete window.geode
})

test('isElectron returns false when window.geode is undefined', () => {
  expect(isElectron()).toBe(false)
})

test('isElectron returns true when window.geode.isElectron is true', () => {
  window.geode = { isElectron: true } as unknown as GeodeBridge
  expect(isElectron()).toBe(true)
})

test('getStoredConnections returns empty when no bridge', async () => {
  await expect(getStoredConnections()).resolves.toEqual([])
})

test('getStoredConnections delegates to the bridge', async () => {
  const stub = jest
    .fn()
    .mockResolvedValue([
      { connectionId: 'c1', token: 't', profileName: 'p', expiresAt: 1 },
    ])
  window.geode = {
    isElectron: true,
    getStoredConnections: stub,
  } as unknown as GeodeBridge
  const got = await getStoredConnections()
  expect(stub).toHaveBeenCalled()
  expect(got[0]?.connectionId).toBe('c1')
})

test('storeConnections noop in browser mode', async () => {
  await expect(storeConnections([])).resolves.toBeUndefined()
})

test('getStoredPassword returns null in browser mode', async () => {
  await expect(getStoredPassword('p', 'u')).resolves.toBeNull()
})

test('storeSavedPassword + clearStoredPassword noop in browser mode', async () => {
  await expect(storeSavedPassword('p', 'u', 'pw')).resolves.toBeUndefined()
  await expect(clearStoredPassword('p', 'u')).resolves.toBeUndefined()
})

test('pickPemFile returns null in browser mode', async () => {
  await expect(pickPemFile()).resolves.toBeNull()
})
