import React from 'react'
import styled from 'styled-components'

const Wrap = styled.div`
  overflow: auto;
  max-height: 480px;
  border: 1px solid ${({ theme }) => theme.colors.border};
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: ${({ theme }) => theme.colors.text};
`
const Th = styled.th`
  position: sticky;
  top: 0;
  background: ${({ theme }) => theme.colors.surface};
  text-align: left;
  padding: 6px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`
const Td = styled.td`
  padding: 6px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
`

type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
}

function columnName(col: Record<string, unknown>, i: number): string {
  const name = col.name
  return typeof name === 'string' && name.length > 0 ? name : `col_${i}`
}

function columnType(col: Record<string, unknown>): string {
  const t = col.type
  return typeof t === 'string' ? t : ''
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export const TableView: React.FC<Props> = ({ resp }) => (
  <Wrap>
    <Table>
      <thead>
        <tr>
          {resp.columns.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Th key={`${columnName(c, i)}_${i}`}>
              {columnName(c, i)} <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {resp.rows.map((row, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <tr key={i}>
            {row.map((cell, j) => (
              // eslint-disable-next-line react/no-array-index-key
              <Td key={j}>{formatCell(cell)}</Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  </Wrap>
)
