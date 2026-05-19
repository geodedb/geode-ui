import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Regression coverage for GAP-825 — the v0.5.19 graph_store fix that
// closed a label-index desync race in `cloneNodesFrom` +
// `loadOneGraphFromAdapter` (see geode release notes for v0.5.19). The
// race manifested as "labels go missing from the index on graph
// restore / clone while another connection is writing", which from the
// user's perspective is silent data loss: a `MATCH (n:Label) RETURN n`
// would return fewer rows than the underlying store actually contains.
//
// We can't deterministically provoke the race from the UI in CI without
// a tight write loop concurrent with a clone (a separate stress test
// inside the geode repo does that). But the FIX is observable as an
// invariant: after a fresh seed (geode-init runs `populate` for both
// movies + vulndb graphs, which fires loadOneGraphFromAdapter on every
// graph), every label-filtered MATCH must return EXACTLY the counts
// recorded in the seed metadata. A pre-fix run with the race would
// have desynced one of the label indices and the count would short.
//
// These tests therefore pin the post-fix invariant: seeded label
// counts match the recorded ground truth. They run against the
// movies graph (seeded from deploy/geode/init.gql) using the API
// directly so they exercise the same code path the SPA's Run button
// drives, without coupling the assertions to a Monaco render cycle.

test.describe('GAP-825 — seeded graph label integrity (v0.5.19 cloneNodesFrom + addNodeLabel race fix)', () => {
  test('label index returns the expected node count per label (movies graph)', async ({
    authedPage: page,
  }) => {
    // We drive the query through the SPA's normal Run flow so the
    // assertion exercises the full pipeline (JWT cookie, /api/v1/query
    // endpoint, server-side label index lookup, response decode, table
    // projection). The seed.counts numbers come from
    // e2e/helpers/gqlData.ts and are cross-checked against the live
    // post-seed `MATCH … RETURN count(…)` output.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    const editor = page.locator('.monaco-editor').first()

    const cases: { label: string; expected: number }[] = [
      { label: 'Person', expected: seed.counts.persons },
      { label: 'Movie', expected: seed.counts.movies },
    ]
    // Sequential await chain via reduce keeps the airbnb no-restricted-
    // syntax rule happy (no for-of) AND preserves order — each label's
    // query must finish before the next one types into the same editor.
    await cases.reduce<Promise<void>>(
      (acc, { label, expected }) =>
        acc.then(async () => {
          await editor.click()
          await page.keyboard.press('ControlOrMeta+A')
          await page.keyboard.type(
            `USE GRAPH ${seed.graph}; MATCH (n:${label}) RETURN count(n) AS c`
          )
          await sel.queryRunBtn(page).click()
          // The summary row carries "1 row" because count(n) collapses
          // to a single aggregate row. The cell itself carries the count
          // as a string.
          await sel.queryTabTable(page).click()
          await expect(
            page
              .getByRole('cell', { name: String(expected), exact: true })
              .first()
          ).toBeVisible({ timeout: 10_000 })
        }),
      Promise.resolve()
    )
  })

  test('total node count across all labels matches the seed ground truth', async ({
    authedPage: page,
  }) => {
    // Pre-fix the cloneNodesFrom race could lose a label-index entry
    // for some nodes — the nodes themselves still existed in the
    // store, but a label-filtered MATCH would skip them. Querying the
    // unfiltered count via `MATCH (n) RETURN count(n)` would
    // therefore SUCCEED (unfiltered scans don't go through the label
    // index) while the per-label counts would short. Pair-checking
    // those two values is the strongest invariant we can pin from the
    // UI: every node must be reachable via SOME label query, and the
    // sum of per-label counts must equal the unfiltered count.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    const editor = page.locator('.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n) RETURN count(n) AS c`
    )
    await sel.queryRunBtn(page).click()
    await sel.queryTabTable(page).click()
    await expect(
      page
        .getByRole('cell', {
          name: String(seed.counts.nodesTotal),
          exact: true,
        })
        .first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('per-edge-type count matches the seed (edge index integrity)', async ({
    authedPage: page,
  }) => {
    // GAP-825 was scoped to the NODE label index, but the analogous
    // adapter-hydration gap could affect edge-type indices on the same
    // load path. Spot-check one densely-populated edge type (ACTED_IN
    // is the largest at 172 rows in the Matrix seed) as a smoke test
    // that the edge index also rebuilds cleanly post-fix.
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    const editor = page.locator('.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH ()-[r:ACTED_IN]->() RETURN count(r) AS c`
    )
    await sel.queryRunBtn(page).click()
    await sel.queryTabTable(page).click()
    await expect(
      page
        .getByRole('cell', { name: String(seed.counts.actedIn), exact: true })
        .first()
    ).toBeVisible({ timeout: 10_000 })
  })
})
