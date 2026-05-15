import { matchesQuery } from './findNode'

describe('matchesQuery', () => {
  it('matches a substring of a top-level prop value', () => {
    expect(matchesQuery({ id: '1', props: { name: 'Alice' } }, 'lice')).toBe(
      true
    )
  })
  it('matches the label too', () => {
    expect(matchesQuery({ id: '1', label: 'Person' }, 'pers')).toBe(true)
  })
  it('ignores case', () => {
    expect(matchesQuery({ id: '1', props: { name: 'ALICE' } }, 'alice')).toBe(
      true
    )
  })
  it('returns false for empty query', () => {
    expect(matchesQuery({ id: '1', props: { name: 'Alice' } }, '')).toBe(false)
  })
  it('matches by raw id', () => {
    expect(matchesQuery({ id: '42', props: {} }, '42')).toBe(true)
  })
  it('returns false when there is no match anywhere', () => {
    expect(matchesQuery({ id: '1', props: { name: 'Bob' } }, 'zzzz')).toBe(
      false
    )
  })
  it('matches one entry in a labels[] array', () => {
    expect(matchesQuery({ id: '1', label: ['Person', 'Actor'] }, 'actor')).toBe(
      true
    )
  })
})
