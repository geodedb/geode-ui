/**
 * GAP-021 / #102: direct unit tests for the shared hook. The two
 * call sites (LoginPage + AddConnectionModal) each have integration
 * coverage that exercises the hook via the rendered components; this
 * file pins the hook contract in isolation so a future refactor of
 * the hook can be reviewed without rendering either consumer.
 */
import { act, renderHook, waitFor } from '@testing-library/react'

jest.mock('../api/auth', () => ({
  fetchPublicProfiles: jest.fn(),
}))

jest.mock('../api/electron-bridge', () => ({
  getStoredPassword: jest.fn(),
  // APP-01 R2: the hook now opens a single-use unlock window before
  // calling getStoredPassword. The mock returns a token by default so
  // the existing pass-through tests keep exercising the read path.
  openUnlockWindow: jest.fn().mockResolvedValue('unlock-token-stub'),
}))

import { fetchPublicProfiles } from '../api/auth'
import { getStoredPassword, openUnlockWindow } from '../api/electron-bridge'
import { usePublicProfilesWithStoredPasswords } from './usePublicProfilesWithStoredPasswords'

const fetchMock = fetchPublicProfiles as jest.MockedFunction<
  typeof fetchPublicProfiles
>
const storedMock = getStoredPassword as jest.MockedFunction<
  typeof getStoredPassword
>
const openUnlockMock = openUnlockWindow as jest.MockedFunction<
  typeof openUnlockWindow
>

describe('usePublicProfilesWithStoredPasswords', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    storedMock.mockReset()
    openUnlockMock.mockReset()
    openUnlockMock.mockResolvedValue('unlock-token-stub')
  })

  it('fetches public profiles on mount and exposes initialProfileName', async () => {
    fetchMock.mockResolvedValueOnce([
      { name: 'default', description: 'D' },
      { name: 'prod', description: 'P' },
    ])
    const { result } = renderHook(() => usePublicProfilesWithStoredPasswords())
    await waitFor(() => {
      expect(result.current.profilesState.profiles).not.toBeNull()
    })
    expect(result.current.profilesState.profiles).toEqual([
      { name: 'default', description: 'D' },
      { name: 'prod', description: 'P' },
    ])
    expect(result.current.profilesState.initialProfileName).toBe('default')
    expect(result.current.profilesState.loadErr).toBe(false)
  })

  it('flags loadErr on rejection and leaves initialProfileName null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => usePublicProfilesWithStoredPasswords())
    await waitFor(() => {
      expect(result.current.profilesState.loadErr).toBe(true)
    })
    expect(result.current.profilesState.profiles).toBeNull()
    expect(result.current.profilesState.initialProfileName).toBeNull()
  })

  it('does not fetch when enabled=false (AddConnectionModal closed)', async () => {
    fetchMock.mockResolvedValueOnce([{ name: 'x', description: '' }])
    renderHook(() => usePublicProfilesWithStoredPasswords({ enabled: false }))
    // Allow microtasks to drain so the fetch (if it were issued)
    // would have a chance to land.
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lookupStoredPassword passes through to the electron-bridge', async () => {
    fetchMock.mockResolvedValueOnce([])
    storedMock.mockResolvedValueOnce('s3cret')
    const { result } = renderHook(() => usePublicProfilesWithStoredPasswords())
    await waitFor(() => {
      expect(result.current.profilesState.profiles).toEqual([])
    })
    await act(async () => {
      const pw = await result.current.lookupStoredPassword('default', 'alice')
      expect(pw).toBe('s3cret')
    })
    // APP-01 R2: the hook opens a fresh unlock window before each
    // read and threads the token through to getStoredPassword.
    expect(openUnlockMock).toHaveBeenCalled()
    expect(storedMock).toHaveBeenCalledWith(
      'default',
      'alice',
      'unlock-token-stub'
    )
  })

  // APP-01 R2: when the unlock window cannot be opened (browser mode,
  // or a future R3 biometric prompt declined), lookupStoredPassword
  // short-circuits to null without calling getStoredPassword.
  it('APP-01 R2: returns null and skips the read when openUnlockWindow returns null', async () => {
    fetchMock.mockResolvedValueOnce([])
    openUnlockMock.mockResolvedValueOnce(null)
    storedMock.mockResolvedValue('would-not-be-returned')
    const { result } = renderHook(() => usePublicProfilesWithStoredPasswords())
    await waitFor(() => {
      expect(result.current.profilesState.profiles).toEqual([])
    })
    await act(async () => {
      const pw = await result.current.lookupStoredPassword('default', 'alice')
      expect(pw).toBeNull()
    })
    expect(storedMock).not.toHaveBeenCalled()
  })

  it('lookupStoredPassword identity is stable across renders', async () => {
    fetchMock.mockResolvedValueOnce([])
    const { result, rerender } = renderHook(() =>
      usePublicProfilesWithStoredPasswords()
    )
    await waitFor(() => {
      expect(result.current.profilesState.profiles).toEqual([])
    })
    const first = result.current.lookupStoredPassword
    rerender()
    rerender()
    expect(result.current.lookupStoredPassword).toBe(first)
  })

  it('resetProfilesState identity is stable across renders', async () => {
    fetchMock.mockResolvedValueOnce([])
    const { result, rerender } = renderHook(() =>
      usePublicProfilesWithStoredPasswords()
    )
    await waitFor(() => {
      expect(result.current.profilesState.profiles).toEqual([])
    })
    const first = result.current.resetProfilesState
    rerender()
    rerender()
    expect(result.current.resetProfilesState).toBe(first)
  })

  it('resetProfilesState restores the initial slot', async () => {
    fetchMock.mockResolvedValueOnce([{ name: 'default', description: 'D' }])
    const { result } = renderHook(() => usePublicProfilesWithStoredPasswords())
    await waitFor(() => {
      expect(result.current.profilesState.profiles).not.toBeNull()
    })
    act(() => {
      result.current.resetProfilesState()
    })
    expect(result.current.profilesState.profiles).toBeNull()
    expect(result.current.profilesState.loadErr).toBe(false)
    expect(result.current.profilesState.initialProfileName).toBeNull()
  })
})
