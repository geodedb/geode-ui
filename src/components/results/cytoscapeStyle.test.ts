import type cytoscape from 'cytoscape'
import { createCytoscapeStyle, labelToColor } from './cytoscapeStyle'
import { darkTheme } from '../../theme/dark'
import { lightTheme } from '../../theme/light'

// Pull the `node` selector block out of the stylesheet so each test can
// reason about a single styling concern without scanning the full array.
function nodeStyle(theme: typeof darkTheme): Record<string, unknown> {
  const sheet = createCytoscapeStyle(theme) as Array<{
    selector: string
    style?: Record<string, unknown>
    css?: Record<string, unknown>
  }>
  const block = sheet.find((b) => b.selector === 'node')
  if (!block) throw new Error('node selector missing from stylesheet')
  // createCytoscapeStyle returns blocks with the `style` discriminant
  // (StylesheetStyle, not StylesheetCSS) — narrow on the JSON shape.
  return (block.style ?? block.css ?? {}) as Record<string, unknown>
}

// Relative-luminance per WCAG 2.x — used to pick a contrast-correct
// label color for an arbitrary node fill. The implementation matches the
// SC 1.4.3 formula so test assertions land on the same threshold the fix
// applies in production.
function relativeLuminance(hex: string): number {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`bad hex color: ${hex}`)
  const channel = (h: string): number => {
    const v = parseInt(h, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(m[1] as string) +
    0.7152 * channel(m[2] as string) +
    0.0722 * channel(m[3] as string)
  )
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// A NodeSingular stub that returns the seeded label/nodeType so the
// stylesheet per-node color callback runs end-to-end.
function fakeNode(nodeType: string): cytoscape.NodeSingular {
  return {
    data: (key: string): unknown => (key === 'nodeType' ? nodeType : undefined),
  } as unknown as cytoscape.NodeSingular
}

function resolveColor(
  v: string | ((e: cytoscape.NodeSingular) => string),
  seed: string
): string {
  return typeof v === 'function' ? v(fakeNode(seed)) : v
}

// "Readable" = the text reads against its immediate perceived background.
// When the text-outline is thick (>= 1px on a 12px glyph), the perceived
// background of the glyph is the OUTLINE, not the more-distant fill. So
// readability is satisfied if EITHER text-vs-fill OR text-vs-outline
// meets 4.5:1 (WCAG AA for body text).
function readable(
  textColor: string,
  outlineColor: string,
  fill: string
): {
  ok: boolean
  best: number
} {
  const a = contrastRatio(textColor, fill)
  const b = contrastRatio(textColor, outlineColor)
  const best = a > b ? a : b
  return { ok: best >= 4.5, best }
}

describe('cytoscapeStyle — node label contrast', () => {
  it('uses readable label color against every palette slot in DARK theme', () => {
    // BUG: the dark-mode palette is pastel mid-lights (lavender, mint,
    // amber, pink, periwinkle, sage, salmon, sky). Pre-fix the label
    // color was hard-coded `#ffffff` and the text-outline matched the
    // fill — yielding a 1.1–1.7 contrast ratio against every palette
    // slot, well below WCAG AA 4.5:1 for body text. The fix should pick
    // a contrasting text/outline pair so the label reads on every fill.
    const style = nodeStyle(darkTheme)
    const labelColorFn = style.color as
      | string
      | ((e: cytoscape.NodeSingular) => string)
    const outlineFn = style['text-outline-color'] as
      | string
      | ((e: cytoscape.NodeSingular) => string)

    const seeds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    seeds.forEach((seed) => {
      const fill = labelToColor(seed, 'dark')
      const label = resolveColor(labelColorFn, seed)
      const outline = resolveColor(outlineFn, seed)
      const { ok, best } = readable(label, outline, fill)
      expect({ seed, fill, label, outline, best }).toMatchObject({ seed })
      expect(ok).toBe(true)
    })
  })

  it('uses readable label color against every palette slot in LIGHT theme', () => {
    const style = nodeStyle(lightTheme)
    const labelColorFn = style.color as
      | string
      | ((e: cytoscape.NodeSingular) => string)
    const outlineFn = style['text-outline-color'] as
      | string
      | ((e: cytoscape.NodeSingular) => string)
    const seeds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    seeds.forEach((seed) => {
      const fill = labelToColor(seed, 'light')
      const label = resolveColor(labelColorFn, seed)
      const outline = resolveColor(outlineFn, seed)
      const { ok, best } = readable(label, outline, fill)
      expect({ seed, fill, label, outline, best }).toMatchObject({ seed })
      expect(ok).toBe(true)
    })
  })

  it.each([
    ['dark', darkTheme],
    ['light', lightTheme],
  ] as const)(
    'text-outline-color differs from the node fill (%s theme) so the halo is visible',
    (variant, theme) => {
      // BUG: pre-fix the text-outline matched the fill, so the outline
      // was invisible (it blended into the node body) — no perceptual
      // halo around the text. The fix should make the outline distinct
      // from the fill so the halo actually renders, which is what makes
      // the white-text-on-light-fill case (and dark-text-on-dark-fill)
      // readable.
      const style = nodeStyle(theme)
      const outlineFn = style['text-outline-color'] as
        | string
        | ((e: cytoscape.NodeSingular) => string)
      const seeds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      seeds.forEach((seed) => {
        const fill = labelToColor(seed, variant)
        const outline = resolveColor(outlineFn, seed)
        expect({ variant, seed, fill, outline }).toMatchObject({ seed })
        expect(outline.toLowerCase()).not.toBe(fill.toLowerCase())
      })
    }
  )
})

// GAP-058: placeholder nodes (synthesised stubs for edge endpoints
// outside the query projection — see pushPlaceholderNodes) used to
// inherit the generic `width: data(size) ?? 38` rule. Combined with
// the focus animation's re-layout that landed on a degenerate value
// and the focused node collapsed to a thin vertical oval. Pin a
// dedicated rule that locks every placeholder to a fixed 40 px disc.
describe('cytoscapeStyle — placeholder node shape', () => {
  it('binds an explicit width/height/shape rule to placeholder nodes', () => {
    const style = createCytoscapeStyle(darkTheme) as Array<{
      selector: string
      style?: Record<string, unknown>
    }>
    const placeholderBlock = style.find(
      (b) => b.selector === 'node[?placeholder]'
    )
    expect(placeholderBlock).toBeDefined()
    expect(placeholderBlock?.style?.width).toBe(40)
    expect(placeholderBlock?.style?.height).toBe(40)
    expect(placeholderBlock?.style?.shape).toBe('ellipse')
  })

  it('keeps the width/height ratio inside [0.7, 1.4]', () => {
    // The bug surfaced as a thin vertical oval — width << height. Pin
    // the contract: a placeholder must be roughly disc-shaped so the
    // focus animation cannot stretch it. Both axes are constants, so
    // the ratio is exactly 1.0 — well inside the acceptance band.
    const style = createCytoscapeStyle(darkTheme) as Array<{
      selector: string
      style?: Record<string, unknown>
    }>
    const block = style.find((b) => b.selector === 'node[?placeholder]')
    const w = block?.style?.width as number
    const h = block?.style?.height as number
    expect(w / h).toBeGreaterThanOrEqual(0.7)
    expect(w / h).toBeLessThanOrEqual(1.4)
  })
})

describe('cytoscapeStyle — edge clickability', () => {
  it('edge style has events:yes and a hit-area-friendly width', () => {
    const style = createCytoscapeStyle(darkTheme) as Array<{
      selector: string
      style?: Record<string, unknown>
    }>
    const edgeBlock = style.find((b) => b.selector === 'edge')
    expect(edgeBlock?.style?.events).toBe('yes')
    // Pre-fix the width was 1.5 px; that's not a comfortable click
    // target. Bump to 3 px and validate the regression here.
    expect(edgeBlock?.style?.width).toBe(3)
  })

  it('edge:active widens to advertise clickability', () => {
    const style = createCytoscapeStyle(darkTheme) as Array<{
      selector: string
      style?: Record<string, unknown>
    }>
    const hover = style.find((b) => b.selector === 'edge:active')
    expect(hover?.style?.width).toBe(5)
  })
})
