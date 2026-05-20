import type { Meta, StoryObj } from '@storybook/react'
import { Logo } from './Logo'

// Public Storybook placeholder SVGs — replace with consumer-supplied assets.
const LIGHT_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#111"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">LIGHT</text></svg>',
)
const DARK_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#111" text-anchor="middle">DARK</text></svg>',
)

const meta: Meta<typeof Logo> = {
  title: 'Display/Logo',
  component: Logo,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Logo>

export const Default: Story = {
  args: { lightSrc: LIGHT_SRC, darkSrc: DARK_SRC, alt: 'Example brand', height: 40 },
}
