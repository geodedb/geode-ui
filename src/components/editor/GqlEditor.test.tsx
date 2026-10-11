import React from 'react'
import { act, render } from '@testing-library/react'
import { GqlEditor } from './GqlEditor'

jest.mock('../../monaco-bootstrap', () => ({}))

// Capture the props GqlEditor hands to <Editor> on every render.
type EditorProps = {
  value?: string
  defaultValue?: string
  onChange?: (v: string | undefined) => void
}
const renders: EditorProps[] = []
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: EditorProps) => {
    renders.push(props)
    return <div data-testid="monaco-editor-stub" />
  },
}))

const last = (): EditorProps => {
  const props = renders[renders.length - 1]
  if (!props) throw new Error('Editor never rendered')
  return props
}

describe('GqlEditor value sync', () => {
  beforeEach(() => {
    renders.length = 0
  })

  test('a stale echo of typed text is not written back into the editor', () => {
    const onChange = jest.fn()
    const view = render(
      <GqlEditor value="MATCH" onChange={onChange} onRun={jest.fn()} />
    )
    expect(last().value).toBe('MATCH')

    // Two keystrokes reach the editor before the parent re-renders.
    act(() => {
      last().onChange?.('MATCH ')
      last().onChange?.('MATCH (')
    })
    expect(onChange).toHaveBeenNthCalledWith(1, 'MATCH ')
    expect(onChange).toHaveBeenNthCalledWith(2, 'MATCH (')

    // A render carrying the older text must not push it into the model.
    view.rerender(
      <GqlEditor value="MATCH " onChange={onChange} onRun={jest.fn()} />
    )
    expect(last().value).toBeUndefined()

    // Neither must the up-to-date echo.
    view.rerender(
      <GqlEditor value="MATCH (" onChange={onChange} onRun={jest.fn()} />
    )
    expect(last().value).toBeUndefined()
  })

  test('an external value change is written into the editor', () => {
    const onChange = jest.fn()
    const view = render(
      <GqlEditor value="RETURN 1" onChange={onChange} onRun={jest.fn()} />
    )
    act(() => {
      last().onChange?.('RETURN 12')
    })
    view.rerender(
      <GqlEditor value="RETURN 12" onChange={onChange} onRun={jest.fn()} />
    )

    // e.g. the schema explorer staged a statement.
    view.rerender(
      <GqlEditor
        value="MATCH (n:Person) RETURN n"
        onChange={onChange}
        onRun={jest.fn()}
      />
    )
    expect(last().value).toBe('MATCH (n:Person) RETURN n')
  })

  test('keeps the change handler identity stable across renders', () => {
    const view = render(
      <GqlEditor value="RETURN 1" onChange={jest.fn()} onRun={jest.fn()} />
    )
    const first = last().onChange
    view.rerender(
      <GqlEditor value="RETURN 2" onChange={jest.fn()} onRun={jest.fn()} />
    )
    expect(last().onChange).toBe(first)
  })
})
