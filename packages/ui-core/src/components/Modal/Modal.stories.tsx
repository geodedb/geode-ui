import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Modal, ConfirmModal } from './Modal'
import { Button } from '../Button'

const meta: Meta<typeof Modal> = {
  title: 'Overlay/Modal',
  component: Modal,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof Modal>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Example modal" closeLabel="Close">
          <p>Modal body content. Press Escape, click the backdrop, or use the × button to close.</p>
        </Modal>
      </>
    )
  },
}

export const Confirm: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open confirm</Button>
        <ConfirmModal
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          title="Delete record?"
          body="This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Keep"
        />
      </>
    )
  },
}
