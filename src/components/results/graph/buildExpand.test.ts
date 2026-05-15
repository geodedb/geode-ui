import { buildExpandStatement } from './buildExpand'

describe('buildExpandStatement', () => {
  it('defaults to undirected with limit 100', () => {
    expect(buildExpandStatement({ id: '7' })).toBe(
      'MATCH (n)-[r]-(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('outgoing direction emits the directed arrow', () => {
    expect(buildExpandStatement({ id: '7', direction: 'out' })).toBe(
      'MATCH (n)-[r]->(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('incoming direction emits the reverse arrow', () => {
    expect(buildExpandStatement({ id: '7', direction: 'in' })).toBe(
      'MATCH (n)<-[r]-(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('label filter applies on m', () => {
    expect(buildExpandStatement({ id: '7', labelFilter: 'Movie' })).toBe(
      'MATCH (n)-[r]-(m:Movie) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('clamps a non-positive limit to 1 and a huge one to 10000', () => {
    expect(buildExpandStatement({ id: '7', limit: 0 })).toContain('LIMIT 1;')
    expect(buildExpandStatement({ id: '7', limit: 999999 })).toContain(
      'LIMIT 10000;'
    )
  })

  it('rejects a non-numeric id by throwing', () => {
    expect(() => buildExpandStatement({ id: 'abc' })).toThrow()
  })

  it('rejects a label filter that is not an identifier', () => {
    expect(() =>
      buildExpandStatement({ id: '7', labelFilter: 'X; DROP DATABASE' })
    ).toThrow()
  })
})
