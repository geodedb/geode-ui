import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../../test-utils/theme'
import { Modal, ConfirmModal } from './Modal'

const wrap = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

test('renders nothing when closed', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open={false} onClose={onClose} title="Hi">
      body
    </Modal>
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('renders dialog and title when open', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open onClose={onClose} title="Confirm">
      body
    </Modal>
  )
  const dlg = screen.getByRole('dialog')
  expect(dlg).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByText('Confirm')).toBeInTheDocument()
})

test('escape key invokes onClose', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open onClose={onClose} title="X">
      body
    </Modal>
  )
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('clicking the backdrop closes the modal', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open onClose={onClose} title="X">
      body
    </Modal>
  )
  // The backdrop is the parent element of the dialog. Fire mouseDown on it.
  const dlg = screen.getByRole('dialog')
  const backdrop = dlg.parentElement!
  fireEvent.mouseDown(backdrop)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('close button has accessible name from closeLabel prop', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open onClose={onClose} title="X" closeLabel="Dismiss">
      body
    </Modal>
  )
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
})

test('close button defaults to "Close" accessible name', () => {
  const onClose = jest.fn()
  wrap(
    <Modal open onClose={onClose} title="X">
      body
    </Modal>
  )
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
})

test('ConfirmModal wires confirm/cancel buttons', () => {
  const onConfirm = jest.fn()
  const onClose = jest.fn()
  wrap(
    <ConfirmModal
      open
      title="Delete?"
      body="permanent"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onConfirm).toHaveBeenCalled()
})

test('ConfirmModal uses custom confirmLabel and cancelLabel', () => {
  const onConfirm = jest.fn()
  const onClose = jest.fn()
  wrap(
    <ConfirmModal
      open
      title="Delete?"
      body="permanent"
      confirmLabel="Delete"
      cancelLabel="Keep"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
  expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
})
