import { act, renderHook } from '@testing-library/react'
import { useWorkspacePanes, MAX_PANES } from './useWorkspacePanes'

describe('useWorkspacePanes', () => {
  it('starts with one pane', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    expect(result.current.panes).toHaveLength(1)
  })
  it('addPane grows up to MAX_PANES then no-ops', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    while (result.current.panes.length < MAX_PANES) {
      act(() => result.current.addPane())
    }
    expect(result.current.panes).toHaveLength(MAX_PANES)
    act(() => result.current.addPane())
    expect(result.current.panes).toHaveLength(MAX_PANES) // no-op past max
  })
  it('removePane shrinks but never below one; ids are unique and not reused', () => {
    const { result } = renderHook(() => useWorkspacePanes())
    act(() => result.current.addPane())
    act(() => result.current.addPane())
    expect(result.current.panes).toHaveLength(3)
    const [id0, id1, id2] = result.current.panes as [string, string, string]
    const ids = [id0, id1, id2]
    expect(new Set(ids).size).toBe(ids.length) // unique
    act(() => result.current.removePane(id1))
    expect(result.current.panes).toEqual([id0, id2])
    act(() => result.current.removePane(id0))
    act(() => result.current.removePane(id2))
    expect(result.current.panes).toHaveLength(1) // never below 1
    act(() => result.current.addPane())
    expect(ids).not.toContain(result.current.panes[1]) // no reuse
  })
})
