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

// Q27 (#173): MigrationsPage applies/signs migrations — destructive. It
// has no ConfirmModal of its own (the "run pending" / "sign" actions
// fire directly), so these tests cover: the run-pending mutation fires
// client.postMigrationsRun and refetches; the error-envelope render
// path (HTTPError surfaced in role="alert"); the file-upload happy path
// (client.migrationUpload); the create-migration modal (client.postMigrations);
// and the wire-feature-missing surface (a 501 from the list endpoint
// renders the friendly error banner + empty tables, run-pending stays
// disabled).
class HTTPError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(body ? `http status ${status}: ${body}` : `http status ${status}`)
  }
}

const getMigrations = jest.fn()
const postMigrations = jest.fn()
const postMigrationsRun = jest.fn()
const migrationUpload = jest.fn()
const sign = jest.fn()

jest.mock('../../api/client', () => ({
  client: {
    getMigrations: (...a: unknown[]) => getMigrations(...a),
    postMigrations: (...a: unknown[]) => postMigrations(...a),
    postMigrationsRun: (...a: unknown[]) => postMigrationsRun(...a),
    migrationUpload: (...a: unknown[]) => migrationUpload(...a),
    sign: (...a: unknown[]) => sign(...a),
  },
}))

import { MigrationsPage } from './MigrationsPage'

import { testTheme as theme } from '../../test-utils/theme'

function renderPage(): void {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <MigrationsPage />
      </MemoryRouter>
    </ThemeProvider>
  )
}

beforeEach(() => {
  getMigrations.mockReset()
  postMigrations.mockReset()
  postMigrationsRun.mockReset()
  migrationUpload.mockReset()
  sign.mockReset()
  getMigrations.mockResolvedValue({
    applied: [{ name: '0001_init', applied_at: '2025-01-01', signed_by: 'ci' }],
    pending: ['0002_add_index'],
  })
  postMigrationsRun.mockResolvedValue({ applied: ['0002_add_index'] })
  postMigrations.mockResolvedValue({ name: '0003_new' })
  migrationUpload.mockResolvedValue({
    file: '0003_new.gql',
    path: '/m/0003_new.gql',
    size_bytes: 12,
    uploaded_at: '2025-01-01T00:00:00Z',
  })
  sign.mockResolvedValue({})
})

test('renders applied + pending migrations from the mocked client', async () => {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('0001_init')).toBeInTheDocument()
    expect(screen.getByText('0002_add_index')).toBeInTheDocument()
  })
  expect(screen.getByText('Pending (1)')).toBeInTheDocument()
  expect(screen.getByText('Applied (1)')).toBeInTheDocument()
})

test('empty migrations state renders both empty-row placeholders', async () => {
  getMigrations.mockResolvedValue({ applied: [], pending: [] })
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('No pending migrations.')).toBeInTheDocument()
  })
  expect(screen.getByText('No applied migrations.')).toBeInTheDocument()
  // No pending migrations -> Run pending is disabled.
  expect(screen.getByRole('button', { name: /Run pending/ })).toBeDisabled()
})

test('run-pending fires client.postMigrationsRun and surfaces the applied count', async () => {
  renderPage()
  await screen.findByText('0002_add_index')
  fireEvent.click(screen.getByRole('button', { name: /Run pending/ }))
  await waitFor(() => {
    expect(postMigrationsRun).toHaveBeenCalledTimes(1)
  })
  // refetch fired after the run.
  await waitFor(() => {
    expect(getMigrations).toHaveBeenCalledTimes(2)
  })
  expect(await screen.findByRole('status')).toHaveTextContent(/Applied 1/)
})

test('error-envelope: a migration_locked HTTPError from run-pending renders in role="alert"', async () => {
  postMigrationsRun.mockRejectedValue(
    new HTTPError(409, '{"error":{"code":"migration_locked"}}')
  )
  renderPage()
  await screen.findByText('0002_add_index')
  fireEvent.click(screen.getByRole('button', { name: /Run pending/ }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('migration_locked')
  expect(alert).toHaveTextContent('409')
})

test('signing a pending migration fires client.sign with the name', async () => {
  renderPage()
  await screen.findByText('0002_add_index')
  const pendingRow = screen
    .getByText('0002_add_index')
    .closest('tr') as HTMLTableRowElement
  fireEvent.click(within(pendingRow).getByRole('button', { name: 'Sign' }))
  await waitFor(() => {
    expect(sign).toHaveBeenCalledWith({ name: '0002_add_index' })
  })
})

test('create-migration modal: file upload posts via client.migrationUpload, then submit calls client.postMigrations', async () => {
  renderPage()
  await screen.findByText('0002_add_index')
  fireEvent.click(screen.getByRole('button', { name: '+ New migration' }))
  const dialog = await screen.findByRole('dialog')

  // Upload a file -> migrationUpload, and the name defaults from the filename.
  const fileInput = within(dialog).getByLabelText(
    'Migration file (.gql / .sql)'
  ) as HTMLInputElement
  const f = new File(['-- migration'], '0003_new.gql', { type: 'text/plain' })
  fireEvent.change(fileInput, { target: { files: [f] } })
  await waitFor(() => {
    expect(migrationUpload).toHaveBeenCalledTimes(1)
  })
  await waitFor(() => {
    expect(within(dialog).getByText('Staged: 0003_new.gql')).toBeInTheDocument()
  })

  // Submit -> postMigrations with the defaulted name.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(postMigrations).toHaveBeenCalledWith({
      name: '0003_new',
      description: '',
    })
  })
})

// GAP-052: the create-migration modal now has a Compose tab. The
// inline-author path synthesises a Blob from the editor body and
// reuses the same migrationUpload endpoint so the server-side
// validation (filename charset + size cap) stays in one place.
test('GAP-052: compose mode synthesises a Blob and submits via migrationUpload', async () => {
  renderPage()
  await screen.findByText('0002_add_index')
  fireEvent.click(screen.getByRole('button', { name: '+ New migration' }))
  const dialog = await screen.findByRole('dialog')

  // Switch to Compose mode.
  fireEvent.click(within(dialog).getByTestId('migration-mode-compose'))

  // Fill the migration name and the inline body.
  const nameInput = within(dialog).getByLabelText('Name') as HTMLInputElement
  fireEvent.change(nameInput, { target: { value: '0003_inline' } })
  const body = within(dialog).getByTestId(
    'migration-compose-body'
  ) as HTMLTextAreaElement
  fireEvent.change(body, {
    target: { value: 'CREATE INDEX ON :Person(name);' },
  })

  // Submit -> upload synthesised blob, then postMigrations.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(migrationUpload).toHaveBeenCalledTimes(1)
  })
  const callArg = migrationUpload.mock.calls[0]?.[0] as {
    file: { filename: string }
  }
  expect(callArg.file.filename).toBe('0003_inline.gql')
  await waitFor(() => {
    expect(postMigrations).toHaveBeenCalledWith({
      name: '0003_inline',
      description: '',
    })
  })
})

test('error-envelope: an upload_failed HTTPError from migrationUpload renders in role="alert"', async () => {
  migrationUpload.mockRejectedValue(
    new HTTPError(400, '{"error":{"code":"migration_upload_failed"}}')
  )
  renderPage()
  await screen.findByText('0002_add_index')
  fireEvent.click(screen.getByRole('button', { name: '+ New migration' }))
  const dialog = await screen.findByRole('dialog')
  const fileInput = within(dialog).getByLabelText(
    'Migration file (.gql / .sql)'
  ) as HTMLInputElement
  const f = new File(['x'], 'bad.gql', { type: 'text/plain' })
  fireEvent.change(fileInput, { target: { files: [f] } })
  const alert = await within(dialog).findByRole('alert')
  expect(alert).toHaveTextContent('migration_upload_failed')
  expect(alert).toHaveTextContent('400')
})

test('wire-feature-missing: a 501 from the list endpoint renders the error banner and empty tables', async () => {
  getMigrations.mockRejectedValue(
    new HTTPError(501, '{"error":{"code":"feature_unavailable"}}')
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('501')
  expect(screen.getByText('No pending migrations.')).toBeInTheDocument()
  expect(screen.getByText('No applied migrations.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Run pending/ })).toBeDisabled()
})
