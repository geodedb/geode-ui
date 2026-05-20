import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { DataTable, TableScroll, EmptyCell } from './DataTable'

const meta: Meta<typeof DataTable> = {
  title: 'Data/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof DataTable>

const sample = [
  { id: 1, name: 'Alice', role: 'Admin', joined: '2024-08-12' },
  { id: 2, name: 'Bob', role: 'Editor', joined: '2025-01-04' },
  { id: 3, name: 'Carol', role: 'Viewer', joined: '2025-03-21' },
]

export const Default: Story = {
  render: () => (
    <TableScroll>
      <DataTable>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td>{u.joined}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableScroll>
  ),
}

export const EmptyState: Story = {
  render: () => (
    <DataTable>
      <thead>
        <tr><th>Name</th><th>Role</th></tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={2}><EmptyCell>No results.</EmptyCell></td>
        </tr>
      </tbody>
    </DataTable>
  ),
}
