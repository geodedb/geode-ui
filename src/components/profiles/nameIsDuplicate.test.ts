import { nameIsDuplicate } from './ProfileEditorModal'

describe('nameIsDuplicate (profile-name client-side validator)', () => {
  it('treats an empty candidate as not a duplicate', () => {
    expect(nameIsDuplicate('', ['Default'])).toBe(false)
    expect(nameIsDuplicate('   ', ['Default'])).toBe(false)
  })

  it('reports a collision with case-insensitive match', () => {
    expect(nameIsDuplicate('Default', ['default'])).toBe(true)
    expect(nameIsDuplicate('default', ['Default'])).toBe(true)
    expect(nameIsDuplicate('DEFAULT', ['Default'])).toBe(true)
  })

  it('reports no collision when names differ', () => {
    expect(nameIsDuplicate('Staging', ['Default', 'Production'])).toBe(false)
  })

  it('strips surrounding whitespace before comparing', () => {
    expect(nameIsDuplicate('  Default  ', ['default'])).toBe(true)
  })

  it('allows the edit-mode current name (no-rename PATCH does not collide)', () => {
    expect(
      nameIsDuplicate('Default', ['Default', 'Production'], 'Default')
    ).toBe(false)
    expect(
      nameIsDuplicate('default', ['Default', 'Production'], 'Default')
    ).toBe(false)
  })

  it('still collides with a PEER name even when a currentName is provided', () => {
    expect(
      nameIsDuplicate('Production', ['Default', 'Production'], 'Default')
    ).toBe(true)
  })

  it('normalises to NFKC before comparing (compatibility decomposition)', () => {
    // Full-width 'A' (U+FF21) NFKC-normalises to ASCII 'A'.
    expect(nameIsDuplicate('Ａpollo', ['Apollo'])).toBe(true)
  })

  it('handles an empty existing list', () => {
    expect(nameIsDuplicate('Anything', [])).toBe(false)
  })
})
