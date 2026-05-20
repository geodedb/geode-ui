import type { Preview, Decorator } from '@storybook/react'
import React from 'react'
import { ThemeProvider as StyledThemeProvider } from 'styled-components'
import { ThemeProvider, lightTheme, darkTheme } from '../src/theme'
import '../src/styles/bootstrap-bridge.css'

const withTheme: Decorator = (Story, context) => {
  const variant = context.globals.theme === 'dark' ? 'dark' : 'light'
  const themeObject = variant === 'dark' ? darkTheme : lightTheme
  return (
    <ThemeProvider>
      <StyledThemeProvider theme={themeObject}>
        <div
          style={{
            background: themeObject.bg?.canvas ?? '#fff',
            color: themeObject.text?.primary ?? '#111',
            padding: '1.5rem',
            minHeight: '100vh',
          }}
        >
          <Story />
        </div>
      </StyledThemeProvider>
    </ThemeProvider>
  )
}

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Color scheme',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      storySort: {
        order: [
          'Welcome',
          'Layout',
          'Forms',
          'Display',
          'Data',
          'Overlay',
        ],
      },
    },
    a11y: { config: { rules: [] } },
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default preview
