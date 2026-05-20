import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { useTheme } from 'styled-components'
import type { ColorScale, Theme } from '@geodedb/ui-core/theme'
import type { QueryRespLike } from '../../lib/graphResult'
import { extractElements } from '../../lib/graphResult'
import {
  applyMatrixBudget,
  buildAdjacencyMatrix,
  DEFAULT_MATRIX_LABEL_BUDGET,
  matrixCellKey,
  type MatrixCell,
} from '../../lib/adjacencyMatrix'

// Wrap is the matrix's flex-column container that fills its parent's
// content box. Kept as a styled-component because the `flex: 1 1 0` +
// `min-height: 0` viewport-fill chain isn't expressible via a single
// Bootstrap utility, and unit tests assert on getComputedStyle (which
// jsdom won't satisfy from Bootstrap class rules — only inline CSS or
// styled-components' injected stylesheet land).
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`

const Table = styled.table`
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  background: ${({ theme }) => theme.bg.surface};

  th,
  td {
    border: 1px solid ${({ theme }) => theme.bg.subtle};
    padding: ${({ theme }) => theme.spacing.xs}
      ${({ theme }) => theme.spacing.sm};
    text-align: center;
    min-width: 3.5rem;
  }
  th[scope='row'] {
    text-align: right;
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.medium};
  }
  th[scope='col'] {
    color: ${({ theme }) => theme.text.secondary};
  }
`

const Td = styled.td<{ $intensity: number }>`
  background-color: ${({ theme, $intensity }) =>
    cellBackground(theme.colors.primaryScale, $intensity)};
  color: ${({ theme, $intensity }) => cellTextColor(theme, $intensity)};
`

// Empty/OverflowBar/OverflowChip migrated to className-driven elements
// per BOOTSTRAP_MIGRATION.md. The bridge maps --bs-body-color etc. so
// `text-body-secondary` and `bg-body-tertiary` track theme tokens.

// Map a 0..1 intensity to a ColorScale step in the 200..800 range
// (intensity 0 → fully transparent, so an empty cell reads as "no edges"
// rather than "the lightest possible heat"). The seven discrete steps
// keep the heatmap legible at small cell sizes.
function cellBackground(scale: ColorScale, intensity: number): string {
  if (intensity <= 0) return 'transparent'
  const step = Math.min(800, 200 + Math.round(intensity * 6) * 100)
  return scale[clampScaleKey(step)]
}

function cellTextColor(theme: Theme, intensity: number): string {
  return intensity > 0.5 ? theme.text.onPrimary : theme.text.primary
}

function clampScaleKey(step: number): keyof ColorScale {
  if (step <= 200) return 200
  if (step <= 300) return 300
  if (step <= 400) return 400
  if (step <= 500) return 500
  if (step <= 600) return 600
  if (step <= 700) return 700
  return 800
}

function edgeTypesSummary(cell: MatrixCell | undefined): string {
  if (!cell) return ''
  return Object.entries(cell.edgeTypes)
    .map(([ty, n]) => `${ty}: ${n}`)
    .join(', ')
}

const MatrixCellTd: React.FC<{
  row: string
  col: string
  cell: MatrixCell | undefined
  max: number
}> = ({ row, col, cell, max }) => {
  const { t } = useTranslation()
  const count = cell?.count ?? 0
  // PERF #216: skip zero-intensity cells from the styled-components
  // pipeline entirely. A 60×60 dense matrix with one edge per pair has
  // 3.6k cells but typically <300 are non-zero; the un-styled `<td>`
  // path renders an empty cell with the aria-label intact but skips
  // the per-cell intensity-based background interpolation.
  if (count <= 0) {
    const empty = t('matrix.cellTitleEmpty', { from: row, to: col })
    return <td aria-label={empty} />
  }
  const intensity = max > 0 ? count / max : 0
  const label = t('matrix.cellTitle', {
    from: row,
    to: col,
    count,
    types: edgeTypesSummary(cell),
  })
  return (
    <Td $intensity={intensity} title={label} aria-label={label}>
      {count}
    </Td>
  )
}

type MatrixViewProps = {
  resp: QueryRespLike
  query?: string
  // PERF #216: per-dimension label budget. Defaults to
  // DEFAULT_MATRIX_LABEL_BUDGET (60); pass 0 to disable the cap (tests).
  labelBudget?: number
}

export const MatrixView: React.FC<MatrixViewProps> = ({
  resp,
  query,
  labelBudget = DEFAULT_MATRIX_LABEL_BUDGET,
}) => {
  const { t } = useTranslation()
  // Subscribe to the theme so the heatmap re-renders on a light/dark
  // flip even though the colours are read via styled-components props.
  useTheme()
  // Pass the query text through so scalar-projection results
  // (`RETURN p.name, r, m.title`, or anything in stream mode where the
  // wire response carries no graph_summary) can still be reconstructed
  // from the MATCH pattern — otherwise the matrix has no labelled
  // nodes and renders the empty state for every such query.
  const matrix = useMemo(
    () => buildAdjacencyMatrix(extractElements(resp, query)),
    [resp, query]
  )
  // PERF #216: apply the label budget BEFORE the render walk so we
  // cap the rendered cell count at budget² (3.6k at the default 60).
  const budgetResult = useMemo(
    () => applyMatrixBudget(matrix, labelBudget),
    [matrix, labelBudget]
  )
  const max = useMemo(() => {
    let m = 0
    matrix.cells.forEach((c) => {
      if (c.count > m) m = c.count
    })
    return m
  }, [matrix])

  if (matrix.labels.length === 0 || max === 0) {
    return (
      <p className="text-body-secondary p-3" role="note">
        {t('matrix.empty')}
      </p>
    )
  }

  const visibleLabels = budgetResult.labels
  const hiddenCount = budgetResult.hiddenLabels.length

  return (
    <Wrap>
      {hiddenCount > 0 && (
        <div
          className="d-flex flex-wrap gap-1 mb-2 small text-body-secondary"
          role="note"
          data-testid="matrix-overflow"
          aria-label={t('matrix.overflow', {
            hidden: hiddenCount,
            shown: visibleLabels.length,
            edges: budgetResult.hiddenEdges,
          })}
        >
          <span className="d-inline-flex align-items-center gap-1 px-2 py-1 bg-body-tertiary text-body rounded fw-medium">
            {t('matrix.overflow', {
              hidden: hiddenCount,
              shown: visibleLabels.length,
              edges: budgetResult.hiddenEdges,
            })}
          </span>
        </div>
      )}
      <Table role="table" aria-label={t('matrix.tableLabel')}>
        <thead>
          <tr>
            <th scope="col" aria-hidden="true" />
            {visibleLabels.map((col) => (
              <th key={col} scope="col">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleLabels.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {visibleLabels.map((col) => (
                <MatrixCellTd
                  key={col}
                  row={row}
                  col={col}
                  cell={matrix.cells.get(matrixCellKey(row, col))}
                  max={max}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Wrap>
  )
}
