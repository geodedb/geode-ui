import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Icon } from './Icon'

const meta: Meta<typeof Icon> = {
  title: 'Display/Icon',
  component: Icon,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    name: { control: 'text' },
    variant: { control: 'select', options: ['solid', 'regular', 'brands'] },
  },
}
export default meta

type Story = StoryObj<typeof Icon>

export const Solid: Story = { args: { name: 'circle-check', variant: 'solid' } }
export const Regular: Story = { args: { name: 'circle-check', variant: 'regular' } }
export const Large: Story = { args: { name: 'rocket', variant: 'solid' } }

export const Gallery: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {['rocket', 'gear', 'user', 'magnifying-glass', 'check', 'exclamation'].map((n) => (
        <div key={n} style={{ textAlign: 'center', minWidth: 80 }}>
          <Icon name={n} />
          <div style={{ fontSize: 12, marginTop: 4 }}>{n}</div>
        </div>
      ))}
    </div>
  ),
}
