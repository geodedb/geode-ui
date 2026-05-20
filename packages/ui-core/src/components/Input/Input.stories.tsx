import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Input, Textarea, Select } from './Input'

const meta: Meta<typeof Input> = {
  title: 'Forms/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    inputSize: { control: 'select', options: ['sm', 'md', 'lg'] },
    type: { control: 'select', options: ['text', 'email', 'password', 'number', 'search', 'url'] },
    disabled: { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = { args: { placeholder: 'Type something…' } }
export const Email: Story = { args: { type: 'email', placeholder: 'you@example.com' } }
export const Disabled: Story = { args: { value: 'Read-only', disabled: true } }

export const TextareaStory: Story = {
  name: 'Textarea',
  render: () => <Textarea placeholder="Multi-line input…" rows={4} />,
}

export const SelectStory: Story = {
  name: 'Select',
  render: () => (
    <Select defaultValue="b">
      <option value="a">Option A</option>
      <option value="b">Option B</option>
      <option value="c">Option C</option>
    </Select>
  ),
}
