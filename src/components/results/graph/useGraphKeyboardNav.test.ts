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
})
