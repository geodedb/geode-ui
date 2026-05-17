/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

// Q27 (#173): RestorePage triggers a database restore — destructive.
// It has no ConfirmModal; the Restore button submits the form directly.
// These tests cover: the restore mutation fires client.restore with the
// right args; the file field is pre-filled from router location state
// (the path BackupPage uses to deep-link a "Restore" row action); the
// upload happy path (client.backupUpload pre-fills the file field); the
// error-envelope render path (HTTPError surfaced in role="alert") for
// both restore and upload failures.
class HTTPError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(body ? `http status ${status}: ${body}` : `http status ${status}`)
  }
}

const restoreFn = jest.fn()
const backupUpload = jest.fn()

jest.mock('../../api/client', () => ({
  client: {
    restore: (...a: unknown[]) => restoreFn(...a),
    backupUpload: (...a: unknown[]) => backupUpload(...a),
  },
}))

import { RestorePage } from './RestorePage'

import { testTheme as theme } from '../../test-utils/theme'

function renderPage(initialEntries?: unknown[]): void {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter
        initialEntries={
          (initialEntries as never[] | undefined) ?? ['/admin/restore']
        }
      >
        <RestorePage />
      </MemoryRouter>
    </ThemeProvider>
  )
}

beforeEach(() => {
  restoreFn.mockReset()
  backupUpload.mockReset()
  restoreFn.mockResolvedValue({})
  backupUpload.mockResolvedValue({
    file: 'uploaded.tar.gz',
    path: '/b/uploaded.tar.gz',
    size_bytes: 99,
    uploaded_at: '2025-01-01T00:00:00Z',
  })
})

test('renders the restore form', () => {
  renderPage()
  expect(screen.getByRole('heading', { name: 'Restore' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'File' })).toBeInTheDocument()
})

test('pre-fills the File field from router location state (BackupPage deep-link)', async () => {
  renderPage([
    { pathname: '/admin/restore', state: { file: 'geode-2025-01-01.tar.gz' } },
  ])
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: 'File' })).toHaveValue(
      'geode-2025-01-01.tar.gz'
    )
  })
})

test('submitting the form fires client.restore with file + target_time', async () => {
  renderPage()
  fireEvent.change(screen.getByRole('textbox', { name: 'File' }), {
    target: { value: 'snap.tar.gz' },
  })
  fireEvent.change(screen.getByLabelText('Target time'), {
    target: { value: '2025-01-01T00:00:00Z' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => {
    expect(restoreFn).toHaveBeenCalledWith({
      file: 'snap.tar.gz',
      target_time: '2025-01-01T00:00:00Z',
    })
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Restore started.'
  )
})

test('uploading a backup file pre-fills the File field via client.backupUpload', async () => {
  renderPage()
  const fileInput = screen.getByLabelText(
    'Upload backup file'
  ) as HTMLInputElement
  const f = new File(['data'], 'fresh.tar.gz', { type: 'application/gzip' })
  fireEvent.change(fileInput, { target: { files: [f] } })
  await waitFor(() => {
    expect(backupUpload).toHaveBeenCalledTimes(1)
  })
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: 'File' })).toHaveValue(
      'uploaded.tar.gz'
    )
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    /uploaded\.tar\.gz/
  )
})

test('error-envelope: a backup_not_found HTTPError from restore renders in role="alert"', async () => {
  restoreFn.mockRejectedValue(
    new HTTPError(404, '{"error":{"code":"backup_not_found"}}')
  )
  renderPage()
  fireEvent.change(screen.getByRole('textbox', { name: 'File' }), {
    target: { value: 'missing.tar.gz' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('backup_not_found')
  expect(alert).toHaveTextContent('404')
})

test('error-envelope: an upload_failed HTTPError from backupUpload renders in role="alert"', async () => {
  backupUpload.mockRejectedValue(
    new HTTPError(413, '{"error":{"code":"backup_upload_failed"}}')
  )
  renderPage()
  const fileInput = screen.getByLabelText(
    'Upload backup file'
  ) as HTMLInputElement
  const f = new File(['too big'], 'big.tar.gz', { type: 'application/gzip' })
  fireEvent.change(fileInput, { target: { files: [f] } })
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('backup_upload_failed')
  expect(alert).toHaveTextContent('413')
})
