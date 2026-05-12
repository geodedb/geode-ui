import type cytoscape from 'cytoscape'
import type { Theme } from '../../theme/types'

// Hand-tuned palettes for the per-label node fills. Each palette
// trades pure-saturation for theme-fit:
//   • light — saturated mid-darks readable on a white canvas with
//     white labels at 12px.
//   • dark  — pastel mid-lights readable on a near-black canvas with
//     dark labels at 12px.
//
// Eight slots is enough headroom for the typical Cypher response (1–4
// labels); above eight we wrap with modulo.
const PALETTES: Record<'light' | 'dark', readonly string[]> = {
  light: [
    '#5b34c7', // brand purple
    '#1d7f74', // teal
    '#b06b00', // burnt orange
    '#a4346b', // magenta
    '#3a4eb5', // indigo
    '#1f7a3a', // forest green
    '#a83a36', // tomato
    '#1f6b87', // ocean blue
  ],
  dark: [
    '#bfa3ff', // lavender (brand)
    '#7fd9cb', // mint
    '#f0c46d', // amber
    '#f7a4c7', // pink
    '#9eb3ff', // periwinkle
    '#9be0a4', // sage
    '#ffaaa3', // salmon
    '#9bd5ec', // sky
  ],
}

// Stable string hash so re-renders pick the same colour for the same
// label, regardless of label order. Cheap; runs once per node.
function hashLabel(label: string): number {
  let h = 0
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0
  }
  return h
}

export function labelToColor(
  label: string,
  variant: 'light' | 'dark' = 'light'
): string {
  const palette = PALETTES[variant]
  return palette[hashLabel(label) % palette.length] as string
}

// Build a Cytoscape stylesheet bound to the active app theme so light/
// dark mode flips actually change the canvas (not just the chrome
// around it). Returns a fresh array each call — callers replace the
// stylesheet on the active core via cy.style(...).update().
//
// The stylesheet defines four element classes that GraphView toggles
// at runtime to drive interaction states without re-running layout:
//   • .gv-faded   — dimmed (non-neighbor of selected node)
//   • .gv-hidden  — visually hidden (per-label visibility toggle)
//   • .gv-emphasized — selected element + 1-hop neighborhood
//   • :selected   — Cytoscape's built-in selection class (used by
//                   the keyboard pickers via cy.$id().select()).
export function createCytoscapeStyle(
  theme: Theme
): cytoscape.StylesheetJsonBlock[] {
  const variant = theme.variant
  const isDark = variant === 'dark'

  // Edges and edge labels need to read against bg.graphCanvas, not
  // bg.canvas (graph canvas is intentionally darker/lighter for
  // contrast — see theme/types.ts).
  const edgeColor = isDark ? '#7d6f96' : '#9c8db5'
  const edgeLabelColor = isDark ? '#cca8fb' : '#5a4a78'
  const nodeBorderColor = isDark ? '#1c0f2e' : '#ffffff'
  const selectedBorder = theme.colors.primary
  const fadedOpacity = 0.18

  return [
    {
      selector: 'node',
      style: {
        'background-color': (e: cytoscape.NodeSingular) =>
          labelToColor((e.data('label') as string) || '', variant),
        // Thin border in canvas color so adjacent nodes don't blur into
        // a single blob when the layout packs tightly.
        'border-width': 1.5,
        'border-color': nodeBorderColor,
        label: 'data(label)',
        color: '#ffffff',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-outline-width': 1.5,
        'text-outline-color': (e: cytoscape.NodeSingular) =>
          labelToColor((e.data('label') as string) || '', variant),
        'font-family': theme.font.family.body,
        'font-size': 12,
        'font-weight': 600,
        width: 38,
        height: 38,
        'overlay-padding': 4,
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 1.5,
        'line-color': edgeColor,
        'target-arrow-color': edgeColor,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        label: 'data(type)',
        'font-family': theme.font.family.body,
        'font-size': 10,
        'font-weight': 500,
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'text-background-color': theme.bg.graphCanvas,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        color: edgeLabelColor,
      },
    },
    {
      // Compound parent nodes — the synthetic per-label "cluster" boxes
      // drawn behind their children when group-by-label clustering is
      // on. A faint dashed rounded-rect with a top-aligned label so it
      // reads as a grouping container, not a real node.
      selector: ':parent',
      style: {
        'background-opacity': 0.08,
        'background-color': theme.colors.neutralScale[500],
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': theme.colors.neutralScale[500],
        'border-opacity': 0.4,
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 11,
        color: theme.text.secondary,
        padding: '12px',
        shape: 'round-rectangle',
      },
    },
    {
      selector: ':selected',
      style: {
        'border-width': 3,
        'border-color': selectedBorder,
        'line-color': selectedBorder,
        'target-arrow-color': selectedBorder,
        width: 3,
      },
    },
    {
      selector: '.gv-emphasized',
      style: {
        'border-width': 3,
        'border-color': selectedBorder,
        'line-color': selectedBorder,
        'target-arrow-color': selectedBorder,
        'z-compound-depth': 'top',
      },
    },
    {
      selector: '.gv-faded',
      style: {
        opacity: fadedOpacity,
        'text-opacity': fadedOpacity,
      },
    },
    {
      selector: '.gv-hidden',
      style: {
        display: 'none',
      },
    },
    // Per-node hide (Phase 2 — the inspector "Hide" / "Collapse"
    // actions and the Hidden/Collapsed restore lists). Distinct from
    // .gv-hidden (the per-label visibility toggle) so the two
    // workflows don't fight over the same class — a node hidden by
    // label and a node hidden individually each have their own
    // restore path. Cytoscape special-cases display:none to skip
    // layout/render for that element (and edges adjacent to it).
    {
      selector: '.hidden-node',
      style: {
        display: 'none',
      },
    },
    // Path-mode highlight classes (Task 1.5). `highlighted` is applied
    // to the nodes + edges on the shortest path between the two picked
    // nodes; `dimmed` to everything else. Raised z-index so the path
    // reads on top of the rest of the (dimmed) graph.
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 3,
        'border-color': theme.colors.primary,
        'z-index': 999,
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': theme.colors.primary,
        'target-arrow-color': theme.colors.primary,
        width: 4,
        'z-index': 998,
      },
    },
    {
      selector: '.dimmed',
      style: {
        opacity: 0.2,
      },
    },
  ]
}
