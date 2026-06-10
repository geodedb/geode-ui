// Cross-route persistence contract for queryPageStore.
//
// The store is a module-level singleton — its state survives the
// React component tree being torn down (e.g. when the user
// navigates from /query to /schema and the QueryPage unmounts).
// This is the contract that delivers "moving between tabs no longer
// resets the editor or the results".

import { useQueryPageStore } from './queryPageStore'

describe('queryPageStore — cross-route memory for QueryPage', () => {
  beforeEach(() => {
    useQueryPageStore.getState().reset()
  })

  it('starts with a default statement so the editor isnt empty', () => {
    expect(useQueryPageStore.getState().stmt).toMatch(/MATCH \(n\) RETURN n/)
  })

  it('persists the editor text across reads (singleton survives unmounts)', () => {
    useQueryPageStore.getState().setStmt('MATCH (m:Movie) RETURN m LIMIT 5')
    // A simulated component unmount happens here — but the module-level
    // store keeps state because it's not tied to any React lifecycle.
    expect(useQueryPageStore.getState().stmt).toBe(
      'MATCH (m:Movie) RETURN m LIMIT 5'
    )
  })

  it('persists the last completed response across reads', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }] as never,
      rows: [[]] as never,
      rowCount: 1,
      elapsedMs: 12,
    }
    useQueryPageStore.getState().setResp(resp)
    useQueryPageStore.getState().setSubmittedStmt('USE GRAPH x; RETURN 1')
    expect(useQueryPageStore.getState().resp).toBe(resp)
    expect(useQueryPageStore.getState().submittedStmt).toBe(
      'USE GRAPH x; RETURN 1'
    )
  })

  it('tracks UI choices (tab, streamMode, expand) so a re-mount can restore them', () => {
    const s = useQueryPageStore.getState()
    s.setTab('graph')
    s.setStreamMode(true)
    s.setExpand(false)
    expect(useQueryPageStore.getState().tab).toBe('graph')
    expect(useQueryPageStore.getState().streamMode).toBe(true)
    expect(useQueryPageStore.getState().expand).toBe(false)
  })

  it('reset() clears every per-session field back to defaults', () => {
    const s = useQueryPageStore.getState()
    s.setStmt('MATCH (m:Movie) RETURN m')
    s.setResp({
      columns: [] as never,
      rows: [] as never,
      rowCount: 0,
      elapsedMs: 0,
    })
    s.setSubmittedStmt('something')
    s.setErr('boom')
    s.setTab('json')
    s.setStreamMode(true)
    s.setExpand(false)

    useQueryPageStore.getState().reset()

    const after = useQueryPageStore.getState()
    expect(after.stmt).toMatch(/MATCH \(n\) RETURN n/) // back to default
    expect(after.resp).toBeNull()
    expect(after.submittedStmt).toBe('')
    expect(after.err).toBeNull()
    expect(after.tab).toBe('table')
    expect(after.streamMode).toBe(false)
    expect(after.expand).toBe(true)
  })
})
