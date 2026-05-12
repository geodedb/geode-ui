/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

// Q27 (#173): BackupPage mutates/destroys data — these tests cover the
// confirm-modal delete flow (confirm fires the mutation, cancel does
// not), the error-envelope render path (HTTPError surfaced in
// role="alert"), and the wire-feature-missing surface (the Download
// row action is permanently disabled; a 501 from the list endpoint
// renders the friendly error banner + empty table).
//
// HTTPError mirrors the generated client's shape (gen/client/react/client.ts):
// `new HTTPError(status, body)` with `message = "http status N: body"`.
class HTTPError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(body ? `http status ${status}: ${body}` : `http status ${status}`)
  }
}

const getBackups = jest.fn()
const postBackups = jest.fn()
const deleteFile = jest.fn()
const backupUpload = jest.fn()

jest.mock('../../api/client', () => ({
  client: {
    getBackups: (...a: unknown[]) => getBackups(...a),
    postBackups: (...a: unknown[]) => postBackups(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    backupUpload: (...a: unknown[]) => backupUpload(...a),
  },
}))

import { BackupPage } from './BackupPage'

import { testTheme as theme } from '../../test-utils/theme'

const sampleBackups = [
  {
    file: 'geode-2025-01-01.tar.gz',
    size_bytes: 2048,
    created_at: '2025-01-01T00:00:00Z',
    graph_count: 3,
    node_count: 100,
    edge_count: 250,
  },
  { file: 'geode-2025-02-01.tar.gz', size_bytes: 1024 },
]

function renderPage(): void {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <BackupPage />
      </MemoryRouter>
    </ThemeProvider>
  )
}

beforeEach(() => {
  getBackups.mockReset()
  postBackups.mockReset()
  deleteFile.mockReset()
  backupUpload.mockReset()
  getBackups.mockResolvedValue({ backups: sampleBackups })
  deleteFile.mockResolvedValue({})
  postBackups.mockResolvedValue({ file: 'geode-new.tar.gz' })
})

test('renders the backup rows from the mocked client', async () => {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('geode-2025-01-01.tar.gz')).toBeInTheDocument()
    expect(screen.getByText('geode-2025-02-01.tar.gz')).toBeInTheDocument()
  })
  // Header reflects the row count.
  expect(screen.getByText('Backups (2)')).toBeInTheDocument()
  // The not-yet-wired Download action is rendered disabled.
  const dlButtons = screen.getAllByRole('button', { name: 'Download' })
  expect(dlButtons.length).toBeGreaterThan(0)
  dlButtons.forEach((b) => expect(b).toBeDisabled())
})

test('empty backup list renders the empty-state row', async () => {
  getBackups.mockResolvedValue({ backups: [] })
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('No backups.')).toBeInTheDocument()
  })
  expect(screen.getByText('Backups (0)')).toBeInTheDocument()
})

test('confirm-modal delete flow: confirm fires client.deleteFile with the file name', async () => {
  renderPage()
  const fileCell = await screen.findByText('geode-2025-01-01.tar.gz')
  const row = fileCell.closest('tr') as HTMLTableRowElement
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

  // Confirm dialog opens.
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByText('Delete backup "geode-2025-01-01.tar.gz"?')
  ).toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => {
    expect(deleteFile).toHaveBeenCalledWith({ file: 'geode-2025-01-01.tar.gz' })
  })
})

test('confirm-modal delete flow: cancel does NOT fire client.deleteFile', async () => {
  renderPage()
  const fileCell = await screen.findByText('geode-2025-01-01.tar.gz')
  const row = fileCell.closest('tr') as HTMLTableRowElement
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  expect(deleteFile).not.toHaveBeenCalled()
})

test('error-envelope: a backup_not_found HTTPError on delete renders in role="alert"', async () => {
  deleteFile.mockRejectedValue(
    new HTTPError(404, '{"error":{"code":"backup_not_found"}}')
  )
  renderPage()
  const fileCell = await screen.findByText('geode-2025-01-01.tar.gz')
  const row = fileCell.closest('tr') as HTMLTableRowElement
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('backup_not_found')
  expect(alert).toHaveTextContent('404')
})

test('wire-feature-missing: a 501 from the list endpoint renders the error banner and an empty table', async () => {
  getBackups.mockRejectedValue(
    new HTTPError(501, '{"error":{"code":"feature_unavailable"}}')
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('501')
  // No backup rows -> the destructive row actions are not present.
  expect(screen.getByText('No backups.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
})

test('create-backup modal posts via client.postBackups', async () => {
  renderPage()
  await screen.findByText('geode-2025-01-01.tar.gz')
  fireEvent.click(screen.getByRole('button', { name: '+ New backup' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Graph'), {
    target: { value: 'movies' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(postBackups).toHaveBeenCalledWith({ graph: 'movies', output: '' })
  })
})
