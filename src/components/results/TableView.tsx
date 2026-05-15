import React, { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { List, RowComponentProps } from 'react-window'
import { projectColumns } from './projectColumns'
import { formatPropValue } from './propFormat'

// PERF-F5 + PERF-F6 (issue #26):
//
// (F5) The previous implementation rendered every row from
// view.rows.map(...) into the DOM. With page_size=1000 that meant
// ~1000 <tr> nodes plus their nested CellView trees, which collapsed
// scroll performance and ballooned memory. We now render the body
// rows through react-window so only the visible slice + a small
// overscan is materialized.
//
// (F6) projectColumns(resp) used to run on every render even when
// neither resp nor expand changed. We now memoize it on those inputs.
// projectColumns itself was also folded into a single discovery pass
// per column instead of three (kindOf + orderedKeys + project).
//
// We deliberately keep header semantics in a real <table> wrapper
// for accessibility/sticky-header behavior; the body is a windowed
// list rendered as a styled grid that mirrors the column layout. This
// is a pragmatic compromise — react-window v2's row-component API
// doesn't render <tr> directly. Existing assertions that look up
// cells by visible text still pass.

// Per-row sizing tunables. `react-window` v2 accepts `rowHeight` as a
// function `(index, props) => number` so we can compute a height that
// fits the wrapped content of each row instead of clipping every row
// to a single line. The estimate is heuristic: we don't measure the
// DOM, we approximate "how many wrapped lines does this content take?"
// from the cell's text length and the column count.
//
// The chars-per-column factor is now WIDTH-AWARE: a `ResizeObserver`
// on the outer wrap feeds the live column-pixel-width into the
// computation so a 375 px viewport gets a smaller chars-per-column
// budget (and therefore taller rows) than a 1400 px viewport. The cap
// (ROW_HEIGHT_MAX) stops a 10 KB string from blowing the virtualizer
// up.
const ROW_HEIGHT_MIN = 36
const ROW_HEIGHT_MAX = 360
const ROW_LINE_HEIGHT = 22 // 14 px font * ~1.5 line-height + safety
const APPROX_CHARS_PER_COLUMN = 18 // legacy fallback when width is unknown
// Minimum legible column width (px). Below this we trigger horizontal
// scroll instead of crushing columns into a single character of width.
const MIN_COLUMN_PX = 140
// Approximate average glyph width at the body font / 14 px size.
const APPROX_CHAR_PX = 7
// Cell horizontal padding (px) — 10 left + 10 right (see `Cell` below).
const CELL_PADDING_PX = 20

// Minimum body height (px). Floored so a pathologically short parent
// still gives the user a usable virtualized body.
const VIRTUAL_BODY_MIN = 240
// The sticky header row (HeaderTable) renders inside Wrap above the
// virtualized body; subtract it from the wrap height so the body +
// header sum equals the wrap content box.
const HEADER_BUDGET_PX = 40

// Outer wrap. `overflow: hidden` on the outermost element clipped the
// body when columns were wider than the viewport — silently dropping
// data with no scrollbar. We now keep the border-radius via
// `overflow: clip` (a render-only clip; doesn't establish a scroll
// container) and let the inner ScrollArea provide horizontal scroll
// when the grid is wider than the viewport.
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  overflow: clip;
  background: ${({ theme }) => theme.bg.surface};
`
// ScrollArea is the horizontal scroll container. The header AND the
// virtualized body sit inside it so they scroll together — otherwise
// a horizontally-scrolled body would slip out from under its sticky
// header. `min-width` on its children forces the grid to be at least
// MIN_COLUMN_PX × column-count wide; below that the user gets a
// scrollbar instead of unreadable columns.
const ScrollArea = styled.div`
  overflow-x: auto;
  overflow-y: hidden;

  /* Don't let the scrollbar steal vertical space from the body. */
  scrollbar-gutter: stable;
`
const HeaderTable = styled.table<{ $minWidthPx: number }>`
  width: 100%;
  min-width: ${({ $minWidthPx }) => $minWidthPx}px;
  border-collapse: collapse;
  color: ${({ theme }) => theme.text.primary};
  table-layout: fixed;
`
const Th = styled.th`
  background: ${({ theme }) => theme.bg.subtle};
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid ${({ theme }) => theme.border.default};
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
  /* Don't collapse small uppercase header labels into illegible
     half-letters when the column gets narrow — wrap onto multiple
     lines instead. */
`
const RowOuter = styled.div<{ $columnCount: number; $minWidthPx: number }>`
  display: grid;
  grid-template-columns: repeat(
    ${({ $columnCount }) => $columnCount},
    minmax(${MIN_COLUMN_PX}px, 1fr)
  );
  min-width: ${({ $minWidthPx }) => $minWidthPx}px;
  border-top: 1px solid ${({ theme }) => theme.border.subtle};
  color: ${({ theme }) => theme.text.primary};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`
const Cell = styled.div`
  padding: 8px 10px;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
  /* No overflow: hidden — rows now grow to fit content via
     estimateRowHeight, so clipping the cell would silently truncate
     wrapped data. Cell content longer than ROW_HEIGHT_MAX is bounded
     by react-window's row-height cap on the outer row, not by hiding
     overflow on the cell. */
  min-width: 0;
`

const NodeChip = styled.span`
  display: inline-block;
  padding: 1px 8px;
  border-radius: ${({ theme }) => theme.radii.pill};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.text.onPrimary};
  margin-right: 4px;
`

const EdgeChip = styled(NodeChip)`
  background: ${({ theme }) => theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.default};
`

const PropList = styled.dl`
  margin: 4px 0 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  font-size: ${({ theme }) => theme.font.sizes.sm};

  dt {
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.medium};
  }

  dd {
    margin: 0;
    color: ${({ theme }) => theme.text.primary};
    word-break: break-word;
  }
`

type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
  // expand: when true (default), project node/edge columns into one
  // column per property. When false, render the existing chip + dl
  // structured cell — useful when the operator wants the raw graph
  // shape rather than a flattened table.
  expand?: boolean
}

function columnName(col: Record<string, unknown>, i: number): string {
  const name = col.name
  return typeof name === 'string' && name.length > 0 ? name : `col_${i}`
}

function columnType(col: Record<string, unknown>): string {
  const t = col.type
  return typeof t === 'string' ? t : ''
}

// Graph result types come back as plain JSON objects with the canonical
// {id, labels, properties} (node), {id, start_node, end_node, type,
// properties} (edge), or {nodes[], edges[]} (path) shape — see
// gen/types/types.gen.go and the geode-client-go conversion in
// rows.go:118-138. We render them in a Cypher-like notation so the
// table is readable, falling back to JSON for any other object.
type AnyRecord = Record<string, unknown>

function isNode(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    Array.isArray(o.labels) &&
    typeof o.properties === 'object' &&
    o.properties !== null &&
    typeof (o as AnyRecord).start_node === 'undefined'
  )
}
function isEdge(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    typeof o.start_node !== 'undefined' &&
    typeof o.end_node !== 'undefined' &&
    typeof o.type === 'string'
  )
}
function isPath(o: AnyRecord): boolean {
  return Array.isArray(o.nodes) && Array.isArray(o.edges)
}

// formatPropValue (cypher-style single-value formatter) lives in
// ./propFormat so the graph inspector's structured property view can
// share it. summarizeProps renders ALL keys of a node/edge property bag in a
// cypher-like " {k: v, ...}" form. We deliberately do NOT truncate —
// the previous "first 2 props + …" form was unhelpful for admin views
// where the interesting fields (username, email, roles) routinely
// landed past the cap. Cell-level wrapping (white-space: pre-wrap on
// the cell) keeps the row readable when the property bag is large.
function summarizeProps(props: AnyRecord): string {
  const keys = Object.keys(props)
  if (keys.length === 0) return ''
  const pairs = keys.map((k) => `${k}: ${formatPropValue(props[k])}`)
  return ` {${pairs.join(', ')}}`
}

function formatNode(o: AnyRecord): string {
  const labels = (o.labels as string[]).map((l) => `:${l}`).join('')
  return `(${labels}${summarizeProps(o.properties as AnyRecord)})`
}
function formatEdge(o: AnyRecord): string {
  return `[:${o.type as string}${summarizeProps(o.properties as AnyRecord)}]`
}
function formatPath(o: AnyRecord): string {
  const n = (o.nodes as unknown[]).length
  const e = (o.edges as unknown[]).length
  return `<path: ${n} nodes, ${e} edges>`
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') {
    const o = v as AnyRecord
    if (isNode(o)) return formatNode(o)
    if (isEdge(o)) return formatEdge(o)
    if (isPath(o)) return formatPath(o)
    return JSON.stringify(o)
  }
  return String(v)
}

// cellLines estimates how many wrapped lines a single cell occupies.
//   • null / undefined / '' → 1 line
//   • node / edge          → 1 chip line + one line per property
//   • everything else      → max of explicit \n-count and ceil(len/cpc)
//
// The character-width heuristic (APPROX_CHARS_PER_COLUMN) is intentionally
// conservative. We'd rather underestimate slightly and let `overflow:
// hidden` on Cell clip the last line than overestimate and waste vertical
// space.
// Q-NEW-4 cap: a node/edge with O(thousands) of properties would force
// `cellLines` to claim a row of equally many lines, which would then
// be clamped at ROW_HEIGHT_MAX anyway. Cap the property-line claim at
// a value that already exceeds ROW_HEIGHT_MAX / ROW_LINE_HEIGHT so the
// final height never depends on iterating beyond this point.
const CELL_LINES_PROP_CAP = Math.ceil(ROW_HEIGHT_MAX / ROW_LINE_HEIGHT)

function cellLines(cell: unknown, charsPerColumn: number): number {
  if (cell === null || cell === undefined) return 1
  if (typeof cell === 'object' && !Array.isArray(cell)) {
    const o = cell as AnyRecord
    if (isNode(o) || isEdge(o)) {
      const props = o.properties as AnyRecord | undefined
      if (!props) return 1
      // We only need to know whether propCount exceeds the cap;
      // counting beyond it is wasted work for an attacker-shaped huge
      // property bag. Object.keys allocates one array but is bounded
      // by the cap below.
      const propCount = Math.min(Object.keys(props).length, CELL_LINES_PROP_CAP)
      return 1 + propCount
    }
  }
  const text = formatCell(cell)
  if (text.length === 0) return 1
  const explicit = text.split('\n').length
  const wrapped = Math.ceil(text.length / Math.max(1, charsPerColumn))
  return Math.max(1, Math.max(explicit, wrapped))
}

// charsPerColumn — chars that fit in one wrapped line of a single
// column at the given pixel width. Falls back to APPROX_CHARS_PER_COLUMN
// when width information is unavailable (server-render, jsdom, or the
// caller from a unit test that's only feeding rows).
function charsPerColumnFor(columnPx: number): number {
  if (!Number.isFinite(columnPx) || columnPx <= 0) {
    return APPROX_CHARS_PER_COLUMN
  }
  const usable = Math.max(1, columnPx - CELL_PADDING_PX)
  return Math.max(6, Math.floor(usable / APPROX_CHAR_PX))
}

// estimateRowHeight is the per-row sizing function fed to react-window's
// <List rowHeight={(i) => …}>. It picks the tallest cell in the row and
// turns its line count into pixels. Floored at ROW_HEIGHT_MIN so a row
// of empty/short cells stays compact; capped at ROW_HEIGHT_MAX so a
// 10 KB JSON cell doesn't blow up the virtualizer. Exported for unit
// tests.
//
// `charsPerColumn` is optional; when omitted we use the legacy width-
// blind constant so unit tests written before the responsive change
// still pass. The component always passes the live, ResizeObserver-
// derived value so the on-screen heights track the real wrap.
export function estimateRowHeight(
  row: unknown[],
  charsPerColumn: number = APPROX_CHARS_PER_COLUMN
): number {
  const maxLines = row.reduce<number>(
    (acc, cell) => Math.max(acc, cellLines(cell, charsPerColumn)),
    1
  )
  // Single-line rows stay at the historical 36 px baseline so the
  // existing virtualization snapshot tests / smoke perf hold steady.
  // Each extra line contributes one ROW_LINE_HEIGHT.
  const h = ROW_HEIGHT_MIN + (maxLines - 1) * ROW_LINE_HEIGHT
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, h))
}

// CellView renders a single cell. For node and edge values it produces
// a structured display — a label/type chip plus a two-column property
// list — so a row with many properties stays readable instead of
// collapsing into a wall of text. Everything else falls through to
// formatCell, keeping the string contract for primitives, paths,
// arrays, and unknown objects (and preserving copy-paste behavior).
//
// Wrapping in React.memo (PERF-F6 / issue #26) lets the windowed list
// skip re-renders for cells whose `value` reference hasn't changed —
// a real win during streaming where the visible slice's row references
// are stable but the parent re-renders on every batch.
const CellView: React.FC<{ value: unknown }> = React.memo(({ value }) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as AnyRecord
    if (isNode(o)) {
      return (
        <div>
          <div>
            {(o.labels as string[]).map((l) => (
              <NodeChip key={l}>:{l}</NodeChip>
            ))}
          </div>
          <PropList>
            {Object.entries(o.properties as AnyRecord).map(([k, v2]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{formatPropValue(v2)}</dd>
              </React.Fragment>
            ))}
          </PropList>
        </div>
      )
    }
    if (isEdge(o)) {
      return (
        <div>
          <div>
            <EdgeChip>:{o.type as string}</EdgeChip>
          </div>
          <PropList>
            {Object.entries(o.properties as AnyRecord).map(([k, v2]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{formatPropValue(v2)}</dd>
              </React.Fragment>
            ))}
          </PropList>
        </div>
      )
    }
  }
  return <>{formatCell(value)}</>
})
CellView.displayName = 'CellView'

type RowProps = {
  rows: unknown[][]
  columnCount: number
  minWidthPx: number
}

// VirtualRow renders one row inside the windowed list. react-window
// supplies the absolute-position style; we lay cells out via a CSS
// grid that mirrors the header column count. role="row" + role="cell"
// keep the divs in the accessibility tree as part of the wrapping
// grid (the surrounding Wrap carries role="grid").
const VirtualRow = ({
  index,
  style,
  rows,
  columnCount,
  minWidthPx,
}: RowComponentProps<RowProps>) => {
  const row = rows[index] || []
  return (
    <RowOuter
      role="row"
      data-row-index={index}
      $columnCount={columnCount}
      $minWidthPx={minWidthPx}
      style={style}
    >
      {row.map((cell, j) => (
        // eslint-disable-next-line react/no-array-index-key
        <Cell key={j} role="cell">
          <CellView value={cell} />
        </Cell>
      ))}
    </RowOuter>
  )
}

export const TableView: React.FC<Props> = ({ resp, expand = true }) => {
  const view = useMemo(
    () => (expand ? projectColumns(resp) : resp),
    [resp, expand]
  )
  const columnCount = Math.max(1, view.columns.length)
  // The grid's pixel-minimum is the per-column floor (MIN_COLUMN_PX)
  // times the column count. Whenever the available container width is
  // less than this, ScrollArea provides horizontal scroll instead of
  // crushing columns into illegible thumb-widths.
  const minGridWidthPx = MIN_COLUMN_PX * columnCount

  // Live container width + height (px). Driven by a ResizeObserver on
  // the outer wrap. The width drives the chars-per-column estimate for
  // `estimateRowHeight`; the height drives the virtualizer body height
  // so the table grows with the page's flex chain (no legacy 720 px
  // cap). Floors at VIRTUAL_BODY_MIN so a tiny parent still shows a
  // usable body.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number | undefined>(
    undefined
  )
  const [bodyHeight, setBodyHeight] = useState<number>(VIRTUAL_BODY_MIN)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = entry.contentRect.width
      const h = entry.contentRect.height
      if (Number.isFinite(w) && w > 0) setContainerWidth(w)
      if (Number.isFinite(h) && h > 0) {
        setBodyHeight(Math.max(VIRTUAL_BODY_MIN, h - HEADER_BUDGET_PX))
      }
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    if (Number.isFinite(r.width) && r.width > 0) setContainerWidth(r.width)
    if (Number.isFinite(r.height) && r.height > 0) {
      setBodyHeight(Math.max(VIRTUAL_BODY_MIN, r.height - HEADER_BUDGET_PX))
    }
    return () => ro.disconnect()
  }, [])

  // Convert the live container width into a per-column character
  // budget. Below the grid's min-width the ScrollArea is scrolling, so
  // each column gets at least MIN_COLUMN_PX worth of chars; above it,
  // the columns share the available space evenly.
  const charsPerColumn = useMemo(() => {
    const effectiveWidth = Math.max(
      minGridWidthPx,
      containerWidth ?? minGridWidthPx
    )
    return charsPerColumnFor(effectiveWidth / columnCount)
  }, [containerWidth, columnCount, minGridWidthPx])

  const rowProps = useMemo<RowProps>(
    () => ({
      rows: view.rows,
      columnCount,
      minWidthPx: minGridWidthPx,
    }),
    [view.rows, columnCount, minGridWidthPx]
  )

  // P-NEW-1: hold a single stable closure identity for the lifetime of
  // the component. A naive useMemo([view.rows]) keeps the closure
  // identity bound to the rows array, but the queryStreamReducer mints
  // a fresh `rows` array on every appended frame — so under streaming
  // the closure rebuilds per batch and react-window invalidates its
  // row-position cache, regressing the F5/F6 win documented in
  // PERF_GAP_ANALYSIS.md (#26). Read the latest rows + the live
  // chars-per-column through refs so the closure identity is stable
  // across renders.
  const rowsRef = useRef(view.rows)
  rowsRef.current = view.rows
  const cpcRef = useRef(charsPerColumn)
  cpcRef.current = charsPerColumn
  const rowHeight = useMemo(
    () =>
      (index: number): number =>
        estimateRowHeight(rowsRef.current[index] ?? [], cpcRef.current),
    []
  )

  // Explicit ARIA roles: react-window renders the body as div-based
  // CSS grid (not a <tbody>), which severs the implicit columnheader
  // role on the standalone <thead><tr><th>. Wrap the whole composition
  // as role="grid" with explicit row/columnheader/cell roles so screen
  // readers (and Playwright's getByRole) see a single coherent table.
  return (
    <Wrap
      ref={wrapRef}
      role="grid"
      aria-rowcount={view.rows.length}
      data-testid="table-view"
    >
      <ScrollArea data-testid="table-scroll-area">
        <HeaderTable $minWidthPx={minGridWidthPx} role="presentation">
          <thead>
            <tr role="row">
              {view.columns.map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Th key={`${columnName(c, i)}_${i}`} role="columnheader">
                  {columnName(c, i)}{' '}
                  <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
                </Th>
              ))}
            </tr>
          </thead>
        </HeaderTable>
        <List
          rowComponent={VirtualRow}
          rowCount={view.rows.length}
          rowHeight={rowHeight}
          rowProps={rowProps}
          defaultHeight={bodyHeight}
          // overflowX: 'visible' delegates horizontal scroll to the
          // shared ScrollArea above, so the column headers and the
          // virtualized body always pan together. Without it,
          // react-window's default `overflow: auto` gives the body
          // its own horizontal scrollbar — header stays put while
          // the body slides, and columns visibly misalign with their
          // headers. Vertical scroll stays inside the List (that's
          // why we don't blanket `overflow: visible`).
          style={{
            height: bodyHeight,
            overflowX: 'visible',
            // The List's default `max-width: 100%` clips the inner
            // content to the parent's clientWidth, which would
            // hide the very horizontal overflow we just freed.
            // Lift it so the body matches the header's intrinsic
            // min-width (driven by minGridWidthPx on RowOuter).
            maxWidth: 'none',
          }}
        />
      </ScrollArea>
    </Wrap>
  )
}
