import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { useTheme } from 'styled-components'
import type { ColorScale, Theme } from '../../theme/types'
import type { QueryRespLike } from '../../lib/graphResult'
import { extractElements } from '../../lib/graphResult'
import {
  buildAdjacencyMatrix,
  matrixCellKey,
  type MatrixCell,
} from '../../lib/adjacencyMatrix'

const Wrap = styled.div`
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

const Empty = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  padding: ${({ theme }) => theme.spacing.md};
`

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
  const intensity = max > 0 ? count / max : 0
  const filledLabel = t('matrix.cellTitle', {
    from: row,
    to: col,
    count,
    types: edgeTypesSummary(cell),
  })
  const label =
    count > 0 ? filledLabel : t('matrix.cellTitleEmpty', { from: row, to: col })
  return (
    <Td
      $intensity={intensity}
      title={count > 0 ? label : undefined}
      aria-label={label}
    >
      {count > 0 ? count : ''}
    </Td>
  )
}

export const MatrixView: React.FC<{ resp: QueryRespLike }> = ({ resp }) => {
  const { t } = useTranslation()
  // Subscribe to the theme so the heatmap re-renders on a light/dark
  // flip even though the colours are read via styled-components props.
  useTheme()
  const matrix = useMemo(
    () => buildAdjacencyMatrix(extractElements(resp)),
    [resp]
  )
  const max = useMemo(() => {
    let m = 0
    matrix.cells.forEach((c) => {
      if (c.count > m) m = c.count
    })
    return m
  }, [matrix])

  if (matrix.labels.length === 0 || max === 0) {
    return <Empty role="note">{t('matrix.empty')}</Empty>
  }

  return (
    <Wrap>
      <Table role="table" aria-label={t('matrix.tableLabel')}>
        <thead>
          <tr>
            <th scope="col" aria-hidden="true" />
            {matrix.labels.map((col) => (
              <th key={col} scope="col">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.labels.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {matrix.labels.map((col) => (
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
