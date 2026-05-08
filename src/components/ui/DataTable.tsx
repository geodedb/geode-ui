import styled from 'styled-components'

// DataTable — shared chrome for the admin/ops/audit tables. The actual
// rows and cells are rendered by the consumer; this primitive just
// owns the visual contract: border, header background, sticky-able
// header, hover row, and an "empty state" cell that spans all columns.
//
// On viewports below `md`, the table sits inside a horizontally-
// scrolling container so long row content (UUIDs, timestamps,
// permission strings) doesn't blow out the layout. Pair with the
// TableScroll wrapper.

export const TableScroll = styled.div`
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`

export const DataTable = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  color: ${({ theme }) => theme.text.primary};
  font-size: ${({ theme }) => theme.font.sizes.md};

  th,
  td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
    vertical-align: middle;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    font-size: ${({ theme }) => theme.font.sizes.sm};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid ${({ theme }) => theme.border.default};
  }

  tbody tr:hover td {
    background: ${({ theme }) => theme.bg.subtle};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
`

export const EmptyCell = styled.td`
  text-align: center;
  color: ${({ theme }) => theme.text.muted};
  padding: ${({ theme }) => theme.spacing.xl} ${({ theme }) => theme.spacing.md};
  font-style: italic;
`
