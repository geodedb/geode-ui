import { GQL_LANGUAGE_ID } from './gqlLanguage'

describe('gqlLanguage', () => {
  test('exports the language id', () => {
    expect(GQL_LANGUAGE_ID).toBe('gql')
  })
})
