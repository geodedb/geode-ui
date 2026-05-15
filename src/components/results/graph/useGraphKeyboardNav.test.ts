import { act, renderHook } from '@testing-library/react'
import { useGraphKeyboardNav } from './useGraphKeyboardNav'

function makeEvent(over: Partial<KeyboardEvent>): KeyboardEvent {
  return { preventDefault: jest.fn(), ...over } as unknown as KeyboardEvent
}

describe('useGraphKeyboardNav', () => {
  it('Tab moves selection to the next neighbor, Shift+Tab to the previous', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: '1',
        neighborIds: ['2', '3', '4'],
        onJump,
        onExpand,
      })
    )
    // First Tab — wraps from initial -1 cursor to neighbor[0] (= '2').
    act(() =>
      result.current.handleKey(makeEvent({ key: 'Tab', shiftKey: false }))
    )
    expect(onJump).toHaveBeenLastCalledWith('2')
    // Shift+Tab from cursor=0 → wraps backward to neighbor[len-1] = '4'.
    act(() =>
      result.current.handleKey(makeEvent({ key: 'Tab', shiftKey: true }))
    )
    expect(onJump).toHaveBeenLastCalledWith('4')
  })

  it('Enter on a selected node fires onExpand with the id', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: '7',
        neighborIds: [],
        onJump,
        onExpand,
      })
    )
    act(() => result.current.handleKey(makeEvent({ key: 'Enter' })))
    expect(onExpand).toHaveBeenCalledWith('7')
  })

  it('no-ops when no selection and no neighbors', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: null,
        neighborIds: [],
        onJump,
        onExpand,
      })
    )
    act(() => result.current.handleKey(makeEvent({ key: 'Tab' })))
    expect(onJump).not.toHaveBeenCalled()
  })

  it('ArrowRight is an alias for Tab and ArrowLeft for Shift+Tab', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: '1',
        neighborIds: ['2', '3'],
        onJump,
        onExpand,
      })
    )
    act(() => result.current.handleKey(makeEvent({ key: 'ArrowRight' })))
    expect(onJump).toHaveBeenLastCalledWith('2')
    act(() => result.current.handleKey(makeEvent({ key: 'ArrowLeft' })))
    // Backward from cursor=0 wraps to last (= '3').
    expect(onJump).toHaveBeenLastCalledWith('3')
  })

  it('Escape blurs the focused element and resets the cursor', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: '1',
        neighborIds: ['2', '3'],
        onJump,
        onExpand,
      })
    )
    // Step forward once so the cursor != -1.
    act(() => result.current.handleKey(makeEvent({ key: 'Tab' })))
    expect(onJump).toHaveBeenLastCalledWith('2')

    // Build a fake event whose target.blur is observable.
    const blur = jest.fn()
    const escEvent = {
      key: 'Escape',
      preventDefault: jest.fn(),
      currentTarget: { blur } as unknown as HTMLElement,
    } as unknown as KeyboardEvent

    act(() => result.current.handleKey(escEvent))
    expect(blur).toHaveBeenCalled()

    // After Escape, the cursor is back at -1 — next Tab again jumps to
    // neighbor[0] = '2', not neighbor[1] = '3'.
    act(() => result.current.handleKey(makeEvent({ key: 'Tab' })))
    expect(onJump).toHaveBeenLastCalledWith('2')
  })
})
