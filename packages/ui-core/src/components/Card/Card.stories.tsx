import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardTitle, CardSubtitle } from './Card'

const meta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Card>

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Card title</CardTitle>
        <CardSubtitle>A short subtitle to describe the card content.</CardSubtitle>
      </CardHeader>
      <p>Body content goes here. Cards are bare surfaces that compose with other primitives.</p>
    </Card>
  ),
}

export const WithoutHeader: Story = {
  render: () => (
    <Card>
      <p style={{ margin: 0 }}>A card with no header — useful for inline panels.</p>
    </Card>
  ),
}
