/// <reference types="@testing-library/jest-dom" />
//
// QUAL #263: exportRespAsNdjson previously built the entire NDJSON
// payload as a single `lines.join('\n')` mega-string and handed it to
// the Blob constructor. That doubles the peak heap footprint of the
// export step (the joined string + the Blob's internal copy) and
// blocks the JS main thread on the join while the row count is in
// the thousands.
//
// Contract: the Blob ctor receives an iterable of multiple parts so
// the runtime can copy each chunk directly into the Blob buffer
// without materialising the full payload as a single string first.

import { exportRespAsNdjson } from './TableView'

function makeResp(rowCount: number) {
  const rows: unknown[][] = []
  for (let i = 0; i < rowCount; i += 1) {
    rows.push([i, `value-${i}`])
  }
  return {
    columns: [
      { name: 'idx', type: 'INTEGER' },
      { name: 'label', type: 'STRING' },
    ],
    rows,
  }
}

describe('exportRespAsNdjson (#263 Blob iterable contract)', () => {
  let originalBlob: typeof Blob
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let blobCalls: Array<{ parts: unknown[]; opts: BlobPropertyBag | undefined }>
  let appendedAnchors: HTMLAnchorElement[]

  beforeEach(() => {
    blobCalls = []
    appendedAnchors = []
    originalBlob = global.Blob
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    // Capture every Blob construction without affecting downstream consumers.
    class SpyBlob extends originalBlob {
      constructor(
        parts?: BlobPart[] | Iterable<BlobPart>,
        opts?: BlobPropertyBag
      ) {
        const arr = parts ? Array.from(parts as Iterable<BlobPart>) : []
        super(arr, opts)
        blobCalls.push({ parts: arr, opts })
      }
    }
    const g = global as unknown as { Blob: typeof Blob }
    g.Blob = SpyBlob
    URL.createObjectURL = jest.fn(() => 'blob:fake-url')
    URL.revokeObjectURL = jest.fn()
    // Spy on appendChild so we can detect the synthetic <a> click side
    // effects, but immediately remove the anchor so we don't pollute
    // the JSDOM tree.
    const realAppendChild = document.body.appendChild.bind(document.body)
    jest
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node: Node) => {
        if (node instanceof HTMLAnchorElement) {
          appendedAnchors.push(node)
          // Suppress real navigation in JSDOM (a.click would invoke
          // anchor click handling).
          jest.spyOn(node, 'click').mockImplementation(() => {})
        }
        return realAppendChild(node) as unknown as Node
      })
  })

  afterEach(() => {
    const g = global as unknown as { Blob: typeof Blob }
    g.Blob = originalBlob
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    jest.restoreAllMocks()
    // Remove any anchors that survived the test path.
    appendedAnchors.forEach((a) => {
      if (a.parentNode) a.parentNode.removeChild(a)
    })
  })

  test('passes a multi-part iterable, not a single joined mega-string, for many rows', () => {
    exportRespAsNdjson(makeResp(50))
    expect(blobCalls).toHaveLength(1)
    const call = blobCalls[0]!
    const { parts, opts } = call
    expect(opts?.type).toBe('application/x-ndjson')
    // The fix's contract: parts.length must be > 1 so the runtime can
    // stream each row into the Blob without ever holding the full
    // payload in a single string. With 50 rows we expect at least 50
    // distinct parts (one per row + the joining newlines).
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.length).toBeGreaterThanOrEqual(50)
  })

  test('still emits valid NDJSON (one record per row, joined by single newlines, trailing newline)', () => {
    exportRespAsNdjson(makeResp(3))
    const call = blobCalls[0]!
    const { parts } = call
    // Reconstruct the joined payload from the iterable to verify
    // semantics are unchanged.
    const text = parts.map((p: unknown) => String(p)).join('')
    const lines = text.split('\n')
    // 3 records + one empty trailing field (from the trailing newline).
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('')
    const decoded = lines.slice(0, 3).map((l: string) => JSON.parse(l))
    expect(decoded[0]).toEqual({ idx: 0, label: 'value-0' })
    expect(decoded[1]).toEqual({ idx: 1, label: 'value-1' })
    expect(decoded[2]).toEqual({ idx: 2, label: 'value-2' })
  })

  test('empty result produces an empty-but-valid Blob with no trailing newline', () => {
    exportRespAsNdjson({
      columns: [{ name: 'idx', type: 'INTEGER' }],
      rows: [],
    })
    expect(blobCalls).toHaveLength(1)
    const call = blobCalls[0]!
    const { parts } = call
    const text = parts.map((p: unknown) => String(p)).join('')
    expect(text).toBe('')
  })
})
