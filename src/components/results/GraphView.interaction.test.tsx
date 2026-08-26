/// <reference types="@testing-library/jest-dom" />
/* eslint-disable no-underscore-dangle */
import React from 'react'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// QUALITY #164: interaction slice of the GraphView test suite — covers
// display-options persistence across remount, the inspector property
// view + JSON toggle, Phase 2 Hide / Collapse / Restore / Explore,
// inspector neighbour chips, pin, focus, and the radial context-menu
// wiring. Shared cytoscape mocks live in __tests__/graphViewMocks.ts.

import { graphViewHarness } from './test-helpers/graphViewMocks'

const { resetCalls, lastCy, classesOf, queryMock } = graphViewHarness

jest.mock('cytoscape', () => {
  const fn = graphViewHarness.cyFactory as unknown as { use: jest.Mock }
  fn.use = graphViewHarness.useMock
  return { __esModule: true, default: fn }
})

jest.mock('../../api/client', () => ({
  client: {
    query: (...args: unknown[]): Promise<unknown> =>
      graphViewHarness.queryMock(...args),
  },
}))

jest.mock('./graph/useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: jest.requireActual('./graph/useCxtMenu').buildCommands,
}))

import { GraphView } from './GraphView'
import type { QueryRespLike } from '../../lib/graphResult'
import { useCxtMenu } from './graph/useCxtMenu'

import { testTheme as theme } from '../../test-utils/theme'

function makeGraphResp(): Record<string, unknown> {
  return {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
        { id: 2, labels: ['Movie'], properties: { title: 'The Matrix' } },
      ],
      edges: [
        { id: 1, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} },
      ],
    },
    row_count: 2,
  }
}

const hubGraphResp: QueryRespLike & { row_count?: number } = {
  rows: [],
  graph_summary: {
    nodes: [1, 2, 3, 4, 5].map((id) => ({
      id,
      labels: ['N'],
      properties: { name: `n${id}` },
    })),
    edges: [
      { id: 12, start_node: 1, end_node: 2, type: 'R', properties: {} },
      { id: 13, start_node: 1, end_node: 3, type: 'R', properties: {} },
      { id: 14, start_node: 1, end_node: 4, type: 'R', properties: {} },
      { id: 45, start_node: 4, end_node: 5, type: 'R', properties: {} },
    ],
  },
  row_count: 5,
} as unknown as QueryRespLike & { row_count?: number }

function renderHub(): ReturnType<typeof render> {
  window.localStorage.clear()
  const view = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  return view
}

function pickNode(view: ReturnType<typeof render>, id: string): void {
  const findInput = view.getByTestId('graph-find-input')
  fireEvent.change(findInput, { target: { value: id } })
  fireEvent.keyDown(findInput, { key: 'Enter' })
}

beforeEach(() => {
  resetCalls()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('graph display options survive a re-run remount', () => {
  function renderGraph(resp: unknown): ReturnType<typeof render> {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={resp as QueryRespLike & { row_count?: number }}
          query="MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  beforeEach(() => {
    window.localStorage.clear()
  })

  test('layout-algorithm choice persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    // Bug C fix: picker is now a Bootstrap dropdown — the trigger's
    // text content reflects the active layout instead of a select.value.
    const picker = first.getByTestId('graph-layout-picker')
    // Default layout is 'cose' ("Force (cose)" in en.ts).
    expect(picker.textContent).toMatch(/cose/i)

    // Open the menu and click "Grid".
    fireEvent.click(picker)
    fireEvent.click(first.getByRole('option', { name: /^Grid$/i }))
    expect(first.getByTestId('graph-layout-picker').textContent).toMatch(
      /grid/i
    )

    first.unmount()
    const second = renderGraph(makeGraphResp())
    expect(second.getByTestId('graph-layout-picker').textContent).toMatch(
      /grid/i
    )
  })

  test('node-label visibility toggle persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    const controls = first.getByTestId('graph-visibility-controls')
    const personToggle = within(controls).getByLabelText(
      /Person/
    ) as HTMLInputElement
    expect(personToggle.checked).toBe(true)

    fireEvent.click(personToggle)
    expect(
      (
        within(first.getByTestId('graph-visibility-controls')).getByLabelText(
          /Person/
        ) as HTMLInputElement
      ).checked
    ).toBe(false)

    first.unmount()
    const second = renderGraph(makeGraphResp())
    const personToggleAfter = within(
      second.getByTestId('graph-visibility-controls')
    ).getByLabelText(/Person/) as HTMLInputElement
    expect(personToggleAfter.checked).toBe(false)
  })

  test('node label-field preference persists across an unmount/remount', () => {
    const first = renderGraph(makeGraphResp())
    const display = first.getByTestId('graph-display-controls')
    const selects = within(display).getAllByRole(
      'combobox'
    ) as HTMLSelectElement[]
    const personSelect = selects[0]!
    const nonDefault = Array.from(personSelect.options)
      .map((o) => o.value)
      .find((v) => v && v !== personSelect.value)
    expect(nonDefault).toBeTruthy()
    fireEvent.change(personSelect, { target: { value: nonDefault } })
    expect(
      (
        within(first.getByTestId('graph-display-controls')).getAllByRole(
          'combobox'
        )[0] as HTMLSelectElement
      ).value
    ).toBe(nonDefault)

    first.unmount()
    const second = renderGraph(makeGraphResp())
    expect(
      (
        within(second.getByTestId('graph-display-controls')).getAllByRole(
          'combobox'
        )[0] as HTMLSelectElement
      ).value
    ).toBe(nonDefault)
  })
})

describe('graph inspector property view', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function makeInspectableResp(): QueryRespLike & { row_count?: number } {
    return {
      rows: [],
      graph_summary: {
        nodes: [
          {
            id: 'n1',
            labels: ['Person'],
            properties: {
              name: 'Alice',
              age: 30,
              active: true,
              nickname: null,
              tags: ['a', 'b'],
            },
          },
        ],
      },
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
  }

  function renderInspectable(): ReturnType<typeof render> {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={makeInspectableResp()}
          query="MATCH (n:Person) RETURN n"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  function selectNode(view: ReturnType<typeof render>, id: string): void {
    const findInput = view.getByTestId('graph-find-input')
    fireEvent.change(findInput, { target: { value: id } })
    fireEvent.keyDown(findInput, { key: 'Enter' })
  }

  test('inspector defaults to the structured property view (not raw JSON)', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    expect(view.getByTestId('graph-inspector-props')).toBeInTheDocument()
    expect(view.queryByTestId('graph-inspector-json')).toBeNull()
  })

  test('property view lists prop keys/values and the identity header', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    const props = view.getByTestId('graph-inspector-props')
    expect(props).toHaveTextContent('name')
    expect(props).toHaveTextContent('Alice')
    expect(props).toHaveTextContent('age')
    expect(props).toHaveTextContent('30')
    expect(props).toHaveTextContent('active')
    expect(props).toHaveTextContent('true')
    expect(props).toHaveTextContent('nickname')
    expect(props).toHaveTextContent('null')
    expect(props).toHaveTextContent('tags')
    expect(props.textContent ?? '').toMatch(/a[\s\S]*b/)

    const inspector = view.getByTestId('graph-inspector')
    expect(inspector).toHaveTextContent('n1')
    expect(inspector).toHaveTextContent('Person')
  })

  test('property keys follow insertion order (matches projectColumns), not alphabetical', () => {
    const resp = {
      rows: [],
      graph_summary: {
        nodes: [
          {
            id: 'n1',
            labels: ['Person'],
            properties: { zebra: 1, apple: 2, mango: 3 },
          },
        ],
      },
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={resp} query="MATCH (n:Person) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    selectNode(view, 'n1')

    const props = view.getByTestId('graph-inspector-props')
    const dtKeys = within(props)
      .getAllByRole('term')
      .map((dt) => dt.textContent)
    expect(dtKeys).toEqual(['zebra', 'apple', 'mango'])
  })

  test('toggling to "Raw JSON" swaps to the <pre> view and back', () => {
    const view = renderInspectable()
    selectNode(view, 'n1')

    const propsBtn = view.getByTestId('graph-inspector-view-props')
    const jsonBtn = view.getByTestId('graph-inspector-view-json')
    expect(propsBtn).toHaveAttribute('aria-pressed', 'true')
    expect(jsonBtn).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(jsonBtn)
    const json = view.getByTestId('graph-inspector-json')
    expect(json).toBeInTheDocument()
    expect(json.textContent ?? '').toContain('"id": "n1"')
    expect(view.queryByTestId('graph-inspector-props')).toBeNull()
    expect(view.getByTestId('graph-inspector-view-json')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(view.getByTestId('graph-inspector-view-props')).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    fireEvent.click(view.getByTestId('graph-inspector-view-props'))
    expect(view.getByTestId('graph-inspector-props')).toBeInTheDocument()
    expect(view.queryByTestId('graph-inspector-json')).toBeNull()
  })
})

describe('Phase 2: inspector Hide / Collapse actions', () => {
  it('Hide adds .hidden-node to the node and closes the inspector', () => {
    const view = renderHub()
    pickNode(view, '2')
    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    const hideBtn = view.getByTestId('graph-action-hide')
    act(() => {
      fireEvent.click(hideBtn)
    })
    expect(classesOf('2')).toContain('hidden-node')
    expect(view.queryByTestId('graph-inspector')).toBeNull()
  })

  it('Collapse hides the degree-1 leaf neighbours and keeps the node selected', () => {
    const view = renderHub()
    pickNode(view, '1')
    const collapseBtn = view.getByTestId('graph-action-collapse')
    act(() => {
      fireEvent.click(collapseBtn)
    })
    expect(classesOf('2')).toContain('hidden-node')
    expect(classesOf('3')).toContain('hidden-node')
    expect(classesOf('4')).not.toContain('hidden-node')
    expect(classesOf('1')).not.toContain('hidden-node')
    expect(view.getByTestId('graph-inspector')).toBeInTheDocument()
    expect(view.getByTestId('graph-inspector')).toHaveTextContent(
      /2 neighbours collapsed/i
    )
  })
})

describe('Phase 2: Hidden / Collapsed restore lists', () => {
  it('lists hidden nodes and restores one from the list', () => {
    const view = renderHub()
    pickNode(view, '2')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-hide'))
    })
    pickNode(view, '3')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-hide'))
    })
    const list = view.getByTestId('graph-hidden-list')
    expect(list).toHaveTextContent('2')
    expect(list).toHaveTextContent('3')
    expect(view.getByText(/hidden \(2\)/i)).toBeInTheDocument()

    const row3 = within(list)
      .getAllByRole('listitem')
      .find((li) => /(^|\D)3(\D|$)/.test(li.textContent ?? ''))
    expect(row3).toBeDefined()
    act(() => {
      fireEvent.click(within(row3!).getByRole('button', { name: /restore/i }))
    })
    expect(classesOf('3')).not.toContain('hidden-node')
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('2')
    expect(view.getByTestId('graph-hidden-list')).not.toHaveTextContent(
      /(^|\D)3(\D|$)/
    )
    expect(view.getByText(/hidden \(1\)/i)).toBeInTheDocument()
  })

  it('lists collapsed nodes and expands one — restoring its leaves', () => {
    const view = renderHub()
    pickNode(view, '1')
    act(() => {
      fireEvent.click(view.getByTestId('graph-action-collapse'))
    })
    const collapsedList = view.getByTestId('graph-collapsed-list')
    expect(collapsedList).toHaveTextContent('1')
    expect(view.getByText(/collapsed \(1\)/i)).toBeInTheDocument()
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('2')
    expect(view.getByTestId('graph-hidden-list')).toHaveTextContent('3')

    const row1 = within(collapsedList)
      .getAllByRole('listitem')
      .find((li) => /(^|\D)1(\D|$)/.test(li.textContent ?? ''))
    expect(row1).toBeDefined()
    act(() => {
      fireEvent.click(within(row1!).getByRole('button', { name: /expand/i }))
    })
    expect(classesOf('2')).not.toContain('hidden-node')
    expect(classesOf('3')).not.toContain('hidden-node')
    expect(view.queryByText(/collapsed \(1\)/i)).toBeNull()
    expect(view.queryByTestId('graph-section-collapsed')).toBeNull()
  })

  it('hides the Hidden and Collapsed sections when nothing is hidden or collapsed', () => {
    const view = renderHub()
    expect(view.queryByTestId('graph-section-hidden')).toBeNull()
    expect(view.queryByTestId('graph-section-collapsed')).toBeNull()
  })
})

describe('Phase 2: Explore neighbours', () => {
  const realResp: QueryRespLike & { row_count?: number } = {
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
        { id: 2, labels: ['Movie'], properties: { title: 'M' } },
      ],
      edges: [
        { id: 9, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} },
      ],
    },
    row_count: 2,
  } as unknown as QueryRespLike & { row_count?: number }

  function renderReal(query?: string): ReturnType<typeof render> {
    window.localStorage.clear()
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={realResp} query={query ?? 'MATCH (n) RETURN n'} />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    return view
  }

  it('fetches the node 1-hop subgraph and merges the new elements', async () => {
    queryMock.mockResolvedValue({
      rows: [],
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
          { id: 3, labels: ['Movie'], properties: { title: 'NewMovie' } },
        ],
        edges: [
          {
            id: 13,
            start_node: 1,
            end_node: 3,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
      row_count: 2,
    })
    const view = renderReal()
    pickNode(view, '1')
    const exploreBtn = view.getByTestId('graph-action-explore')
    expect(exploreBtn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(exploreBtn)
    })
    expect(queryMock).toHaveBeenCalledTimes(1)
    const arg = queryMock.mock.calls[0][0] as {
      statement: string
      pageSize?: number
      timeoutMs?: number
    }
    expect(arg.statement).toMatch(/id\([^)]*\)\s*=\s*1\b/)
    expect(arg.statement).toMatch(/RETURN/i)
    expect(arg.pageSize).toBe(200)
    expect(arg.timeoutMs).toBe(30000)
    const addedIds = ((lastCy().__addCalls as unknown[]) ?? [])
      .flatMap((c) => (Array.isArray(c) ? c : [c]))
      .map((e) => (e as { data?: { id?: unknown } })?.data?.id)
      .map((x) => String(x))
    expect(addedIds).toEqual(expect.arrayContaining(['3', 'e13']))
    expect(addedIds).not.toContain('1')
    expect(lastCy().layout).toHaveBeenCalled()
  })

  it('disables the action for a synthesised / non-numeric node id', () => {
    const synthResp = {
      rows: [['Alice', 'M']],
      columns: [{ name: 'name' }, { name: 'title' }],
      graph_summary: {},
      row_count: 1,
    } as unknown as QueryRespLike & { row_count?: number }
    window.localStorage.clear()
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView
          resp={synthResp}
          query="MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, m.title"
        />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    pickNode(view, 'p:Alice')
    const exploreBtn = view.getByTestId('graph-action-explore')
    // React 19 assigns `disabled`/`title` as element PROPERTIES on
    // upgraded custom elements (WA's wa-button), so jest-dom's
    // attribute-based toBeDisabled()/toHaveAttribute() no longer see
    // them in jsdom. Assert the property contract instead.
    const exploreState = exploreBtn as unknown as {
      disabled?: boolean
      title?: string
    }
    expect(exploreState.disabled).toBe(true)
    expect(exploreState.title).toBeTruthy()
  })

  it('surfaces a fetch failure via the graph error banner', async () => {
    queryMock.mockRejectedValue(new Error('explore boom'))
    const view = renderReal()
    pickNode(view, '1')
    await act(async () => {
      fireEvent.click(view.getByTestId('graph-action-explore'))
    })
    await waitFor(() => {
      expect(view.container.querySelector('[role="alert"]')).not.toBeNull()
    })
    const bannerText =
      view.container.querySelector('[role="alert"]')?.textContent ?? ''
    expect(bannerText).toMatch(/could not load neighbours: explore boom/i)
    expect(bannerText).not.toMatch(/failed to render graph/i)
  })
})

describe('GraphView — inspector neighbors', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lists 1-hop neighbors of the selected node and jumps when clicked', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })

    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })

    const panel = view.getByTestId('graph-neighbors')
    expect(panel).toBeInTheDocument()

    const chip = view.getByTestId('graph-neighbor-chip-2')
    fireEvent.click(chip)

    expect(view.getByTestId('graph-inspector')).toHaveTextContent(/Node 2/i)
  })
})

describe('GraphView — pin action', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('Pin button toggles aria-pressed and locks the underlying node', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })

    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    const pin = view.getByTestId('graph-action-pin')
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pin)
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pin)
    expect(pin).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('GraphView — focus action', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('Focus action dims nodes more than N hops from the selection', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    const focusBtn = view.getByTestId('graph-action-focus')
    expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(focusBtn)
    expect(focusBtn).toHaveAttribute('aria-pressed', 'true')
    expect(view.getByTestId('graph-focus-hops')).toBeInTheDocument()
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'true'
    )
    fireEvent.click(focusBtn)
    expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'false'
    )
  })

  it('Focus action shows the persistent Clear chip; clicking it clears focus', () => {
    const view = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    fireEvent.change(view.getByTestId('graph-find-input'), {
      target: { value: '1' },
    })
    fireEvent.keyDown(view.getByTestId('graph-find-input'), { key: 'Enter' })
    fireEvent.click(view.getByTestId('graph-action-focus'))
    const chip = view.getByTestId('graph-focus-clear-chip')
    expect(chip).toBeInTheDocument()
    fireEvent.click(chip)
    expect(view.queryByTestId('graph-focus-clear-chip')).toBeNull()
    expect(view.getByTestId('graph-canvas')).toHaveAttribute(
      'data-focus-active',
      'false'
    )
  })
})

describe('GraphView — radial context menu', () => {
  afterEach(() => jest.clearAllMocks())

  it('mounts useCxtMenu with the orchestrator handlers, theme, and sig', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphView resp={hubGraphResp} query="MATCH (n) RETURN n" />
      </ThemeProvider>
    )
    act(() => {
      jest.advanceTimersByTime(300)
    })
    expect(useCxtMenu).toHaveBeenCalled()
    const call = (useCxtMenu as jest.Mock).mock.calls[0][0]
    expect(call.cyRef).toBeDefined()
    expect(call.handlers.onZoomTo).toBeInstanceOf(Function)
    expect(call.handlers.onExpand).toBeInstanceOf(Function)
    expect(call.handlers.onHide).toBeInstanceOf(Function)
    expect(call.handlers.onCollapse).toBeInstanceOf(Function)
    expect(call.handlers.onFocus).toBeInstanceOf(Function)
    expect(call.handlers.onPin).toBeInstanceOf(Function)
    expect(call.handlers.onCopyId).toBeInstanceOf(Function)
    expect(call.theme).toBeDefined()
    expect(call.sig).toEqual(expect.any(String))
  })
})
