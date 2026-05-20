import React from 'react'
import styled from 'styled-components'

// AuditFieldList — renders the audit entry's `fields` map as a
// key→value list. Primitives render inline; nested objects and arrays
// serialise to compact JSON so the row still fits on one line for
// most events but the full payload remains visible.
//
// Why: the prior implementation dumped the entire fields object as one
// JSON.stringify blob in the Fields column, making it impossible for
// the operator to grep visually for "user=alice" across 200 rows.

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 480px;
`

const Item = styled.li`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-family: ${({ theme }) => theme.font.family.mono};
  word-break: break-word;
`

const Key = styled.span`
  color: ${({ theme }) => theme.text.muted};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  flex-shrink: 0;
`

const Value = styled.span`
  color: ${({ theme }) => theme.text.primary};
  white-space: pre-wrap;
`

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  // BigInt cannot be JSON.stringify-ed (throws TypeError). Preserve the
  // `n` suffix so the audit row still shows the value as a BigInt.
  if (typeof v === 'bigint') return `${v.toString()}n`
  // Symbol cannot be JSON.stringify-ed (returns undefined, which would
  // render as an empty cell). Surface the Symbol(description) form.
  if (typeof v === 'symbol') return v.toString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export interface AuditFieldListProps {
  fields: Record<string, unknown> | undefined
}

export const AuditFieldList: React.FC<AuditFieldListProps> = ({ fields }) => {
  if (!fields) return null
  const keys = Object.keys(fields).sort()
  if (keys.length === 0) return null
  return (
    <List data-testid="audit-field-list">
      {keys.map((k) => (
        <Item key={k} data-testid="audit-field-item">
          <Key>{k}:</Key>
          <Value>{formatValue(fields[k] ?? null)}</Value>
        </Item>
      ))}
    </List>
  )
}
