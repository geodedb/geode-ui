import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { DedupedDatalist } from './DedupedDatalist'

const meta: Meta<typeof DedupedDatalist> = {
  title: 'Forms/DedupedDatalist',
  component: DedupedDatalist,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof DedupedDatalist>

export const Default: Story = {
  args: {
    id: 'fruits',
    values: ['apple', 'banana', 'apple', 'cherry', 'banana', 'date'],
  },
  render: (args) => (
    <div>
      <input list={args.id} placeholder="Pick a fruit…" />
      <DedupedDatalist {...args} />
    </div>
  ),
}

export const Empty: Story = {
  args: { id: 'empty', values: [] },
  render: (args) => (
    <div>
      <input list={args.id} placeholder="No options" />
      <DedupedDatalist {...args} />
    </div>
  ),
}
