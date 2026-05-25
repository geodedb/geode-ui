/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { WindowControls } from './WindowControls'
import { testTheme as theme } from '../../test-utils/theme'
import '../../services/i18n'

const minimizeMock = jest.fn().mockResolvedValue(true)
const toggleMaxMock = jest.fn().mockResolvedValue(false)
const toggleFullscreenMock = jest.fn().mockResolvedValue(false)
const closeMock = jest.fn().mockResolvedValue(true)
const isMaxMock = jest.fn().mockResolvedValue(false)
const isFullscreenMock = jest.fn().mockResolvedValue(false)
let onMaxChangeHandler: ((maximized: boolean) => void) | null = null
let onFullscreenChangeHandler: ((fullscreen: boolean) => void) | null = null

beforeEach(() => {
  minimizeMock.mockClear()
  toggleMaxMock.mockClear()
  toggleFullscreenMock.mockClear()
  closeMock.mockClear()
  isMaxMock.mockClear()
  isFullscreenMock.mockClear()
  onMaxChangeHandler = null
  onFullscreenChangeHandler = null
})

function installBridge(platform: string): void {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global as unknown as { window: Window }).window.geode = {
    isElectron: true,
    serverUrl: 'http://localhost:8080',
    platform,
    windowMinimize: minimizeMock,
    windowToggleMaximize: toggleMaxMock,
    windowClose: closeMock,
    windowIsMaximized: isMaxMock,
    onWindowMaximizedChange: (handler: (m: boolean) => void) => {
      onMaxChangeHandler = handler
      return () => {
        onMaxChangeHandler = null
      }
    },
    windowToggleFullscreen: toggleFullscreenMock,
    windowIsFullscreen: isFullscreenMock,
    onWindowFullscreenChange: (handler: (f: boolean) => void) => {
      onFullscreenChangeHandler = handler
      return () => {
        onFullscreenChangeHandler = null
      }
    },
  } as unknown as Window['geode']
}

function clearBridge(): void {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(global as unknown as { window: Window }).window.geode =
    undefined as unknown as Window['geode']
}

const wrap = (n: React.ReactNode): ReturnType<typeof render> =>
  render(<ThemeProvider theme={theme}>{n}</ThemeProvider>)

test('renders nothing when not running under Electron', () => {
  clearBridge()
  const { container } = wrap(<WindowControls />)
  expect(container.firstChild).toBeNull()
})

test('renders nothing on macOS even under Electron', () => {
  installBridge('darwin')
  const { container } = wrap(<WindowControls />)
  expect(container.firstChild).toBeNull()
})

test('renders four buttons on Linux', () => {
  installBridge('linux')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /enter full screen/i })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /close window/i })
  ).toBeInTheDocument()
})

test('renders four buttons on Windows', () => {
  installBridge('win32')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /enter full screen/i })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /close window/i })
  ).toBeInTheDocument()
})

test('clicking minimize invokes windowMinimize', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /minimize/i }))
  await waitFor(() => expect(minimizeMock).toHaveBeenCalled())
})

test('clicking close invokes windowClose', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /close window/i }))
  await waitFor(() => expect(closeMock).toHaveBeenCalled())
})

test('clicking maximize invokes windowToggleMaximize', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /maximize/i }))
  await waitFor(() => expect(toggleMaxMock).toHaveBeenCalled())
})

test('clicking fullscreen invokes windowToggleFullscreen', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  fireEvent.click(screen.getByRole('button', { name: /enter full screen/i }))
  await waitFor(() => expect(toggleFullscreenMock).toHaveBeenCalled())
})

test('button label switches to Restore when window becomes maximized', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument()

  onMaxChangeHandler!(true)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
  )

  onMaxChangeHandler!(false)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /maximize/i })
    ).toBeInTheDocument()
  )
})

test('fullscreen label switches when window enters/exits fullscreen', async () => {
  installBridge('linux')
  wrap(<WindowControls />)
  expect(
    screen.getByRole('button', { name: /enter full screen/i })
  ).toBeInTheDocument()

  onFullscreenChangeHandler!(true)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /exit full screen/i })
    ).toBeInTheDocument()
  )
})

test('button surface is opt-out of the Electron drag region', () => {
  installBridge('linux')
  const { container } = wrap(<WindowControls />)
  const root = container.firstChild as HTMLElement
  expect(root.style.getPropertyValue('-webkit-app-region')).toBe('no-drag')
})
