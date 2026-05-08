import React from 'react'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('redirects unauthenticated users to login', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: /Sign in/i })
    ).toBeInTheDocument()
  })
})
