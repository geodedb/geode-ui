import { GQL_LANGUAGE_ID, GQL_KEYWORDS } from './gqlLanguage'

describe('gqlLanguage', () => {
  test('exports the language id', () => {
    expect(GQL_LANGUAGE_ID).toBe('gql')
  })

  // The dashboard's ClusterCard depends on `SHOW CLUSTER STATUS` being
  // highlighted correctly in the editor — keyword surface is registered
  // via Monaco's setMonarchTokensProvider which we don't want to spin up
  // under jsdom, so we assert directly against the hoisted export.
  test('GQL keyword list includes SHOW CLUSTER STATUS tokens', () => {
    expect(GQL_KEYWORDS).toContain('SHOW')
    expect(GQL_KEYWORDS).toContain('CLUSTER')
    expect(GQL_KEYWORDS).toContain('STATUS')
  })
})
