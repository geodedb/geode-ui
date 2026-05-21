/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'

jest.mock('../../api/auth', () => ({
  ...jest.requireActual('../../api/auth'),
  onboardProfile: jest.fn(),
}))

// NB: these imports intentionally appear AFTER `jest.mock` so the
// auto-hoisted factory replaces the module before OnboardProfileForm's
// import resolves, and so the mocked `onboardProfile` reference comes
// from the SAME post-mock module graph the SUT sees (otherwise the
// assertion would target a different jest.fn()).
import { OnboardProfileForm } from './OnboardProfileForm'
import { onboardProfile } from '../../api/auth'

const mockOnboard = onboardProfile as jest.MockedFunction<typeof onboardProfile>

function wrap(ui: React.ReactElement): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={lightTheme}>{ui}</ThemeProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  mockOnboard.mockReset()
})

test('submit POSTs the form data and fires onSuccess with the server response', async () => {
  mockOnboard.mockResolvedValueOnce({
    profile_id: 'onb-prod',
    profile_name: 'prod',
    access_token: 'jwt-abc',
    token_type: 'bearer',
    expires_in: 3600,
    connection_id: '',
  })
  const onSuccess = jest.fn()

  render(wrap(<OnboardProfileForm onSuccess={onSuccess} onCancel={() => {}} />))

  fireEvent.change(screen.getByTestId('onboard-name'), {
    target: { value: 'prod' },
  })
  fireEvent.change(screen.getByTestId('onboard-dsn'), {
    target: { value: 'quic://prod.example.com:3141' },
  })
  fireEvent.change(screen.getByTestId('onboard-description'), {
    target: { value: 'production cluster' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-username'), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-password'), {
    target: { value: 'pw' }, // pragma: allowlist secret
  })
  fireEvent.click(screen.getByTestId('onboard-submit'))

  await waitFor(() => {
    expect(mockOnboard).toHaveBeenCalledWith({
      name: 'prod',
      dsn: 'quic://prod.example.com:3141',
      description: 'production cluster',
      admin_username: 'alice',
      admin_password: 'pw', // pragma: allowlist secret
    })
  })
  await waitFor(() => {
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_name: 'prod',
        access_token: 'jwt-abc',
      })
    )
  })
})

test('renders the server error message on failure', async () => {
  mockOnboard.mockRejectedValueOnce(
    new Error('upstream rejected the credentials')
  )

  render(wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={() => {}} />))

  fireEvent.change(screen.getByTestId('onboard-name'), {
    target: { value: 'p' },
  })
  fireEvent.change(screen.getByTestId('onboard-dsn'), {
    target: { value: 'quic://x:3141' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-username'), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByTestId('onboard-admin-password'), {
    target: { value: 'wrong' }, // pragma: allowlist secret
  })
  fireEvent.click(screen.getByTestId('onboard-submit'))

  expect(
    await screen.findByText(/upstream rejected the credentials/)
  ).toBeInTheDocument()
})

test('clicking Cancel fires onCancel and does NOT call onboardProfile', () => {
  const onCancel = jest.fn()
  render(wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={onCancel} />))
  fireEvent.click(screen.getByTestId('onboard-cancel'))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(mockOnboard).not.toHaveBeenCalled()
})

test('Submit button is disabled while any required field is empty', () => {
  render(wrap(<OnboardProfileForm onSuccess={() => {}} onCancel={() => {}} />))
  const submit = screen.getByTestId('onboard-submit') as HTMLButtonElement
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByTestId('onboard-name'), {
    target: { value: 'p' },
  })
  expect(submit).toBeDisabled() // dsn / username / password still empty
})
