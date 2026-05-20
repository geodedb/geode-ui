import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Field } from './Field'

const meta: Meta<typeof Field> = {
  title: 'Forms/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Field>

export const Default: Story = {
  args: { label: 'Email address', htmlFor: 'email' },
  render: (args) => (
    <Field {...args}>
      <input id="email" type="email" placeholder="you@example.com" />
    </Field>
  ),
}

export const WithError: Story = {
  args: { label: 'Password', htmlFor: 'pw', error: 'Must be at least 12 characters.' },
  render: (args) => (
    <Field {...args}>
      <input id="pw" type="password" />
    </Field>
  ),
}

export const WithHint: Story = {
  args: { label: 'Display name', htmlFor: 'name', hint: 'Visible to other workspace members.' },
  render: (args) => (
    <Field {...args}>
      <input id="name" />
    </Field>
  ),
}

export const Required: Story = {
  args: { label: 'Full name', htmlFor: 'fullname', required: true },
  render: (args) => (
    <Field {...args}>
      <input id="fullname" />
    </Field>
  ),
}
