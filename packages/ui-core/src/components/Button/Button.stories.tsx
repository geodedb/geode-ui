import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Icon } from '../Icon'

const meta: Meta<typeof Button> = {
  title: 'Forms/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: { children: 'Click me' },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Danger: Story = { args: { variant: 'danger' } }
export const Loading: Story = { args: { variant: 'primary', loading: true } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true } }

export const WithIcon: Story = {
  render: () => (
    <Button variant="primary">
      <Icon name="rocket" /> Launch
    </Button>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}
