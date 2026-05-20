import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Stack, Inline, Grid, Spacer } from './Stack'

const Box = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '0.5rem 0.75rem', background: '#3b82f6', color: '#fff', borderRadius: 6 }}>
    {children}
  </div>
)

const meta: Meta<typeof Stack> = {
  title: 'Layout/Stack',
  component: Stack,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    $gap: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    $align: { control: 'select', options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    $justify: { control: 'select', options: ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'] },
  },
}
export default meta

type Story = StoryObj<typeof Stack>

export const Vertical: Story = {
  args: { $gap: 'md' },
  render: (args) => (
    <Stack {...args}>
      <Box>One</Box>
      <Box>Two</Box>
      <Box>Three</Box>
    </Stack>
  ),
}

export const HorizontalInline: Story = {
  name: 'Inline (horizontal)',
  render: () => (
    <Inline $gap="sm">
      <Box>A</Box>
      <Box>B</Box>
      <Box>C</Box>
    </Inline>
  ),
}

export const TwoColumnGrid: Story = {
  name: 'Grid (2 columns)',
  render: () => (
    <Grid $columns="1fr 1fr" $gap="md">
      <Box>1</Box>
      <Box>2</Box>
      <Box>3</Box>
      <Box>4</Box>
    </Grid>
  ),
}

export const WithSpacer: Story = {
  render: () => (
    <Inline>
      <Box>Left</Box>
      <Spacer />
      <Box>Right</Box>
    </Inline>
  ),
}
