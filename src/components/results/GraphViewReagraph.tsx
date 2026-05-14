import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from 'styled-components'
import { GraphCanvas } from 'reagraph'
import { useGraphElements } from './graph/useGraphElements'
import { toReagraphElements } from './graph/reagraphElements'
import type { QueryRespLike } from '../../lib/graphResult'
import { Canvas, Overlay, Wrap } from './graph/styled'

// Phase 0 — spike renderer. Mounts a <GraphCanvas/> with the projected
// element set and a default force-directed 2D layout. Theme parity (node
// fills, edge fills, label/canvas backgrounds) lands here; everything
// else (selection, context menu, focus mode, lasso, minimap, custom DOM
// nodes, find, badges, tooltip, expand-query, path mode, sidebar,
// ResizeObserver re-fit, keyboard nav) is intentionally absent — those
// land in plans P1–P4 once perf is proven.
//
// The component shares the same Props shape as GraphViewCytoscape so the
// dispatcher (GraphView.tsx) is a drop-in branch.

export type GraphViewReagraphProps = {
  resp: QueryRespLike & { row_count?: number }
  query?: string
  height?: number
  fillHeight?: boolean
}

export const GraphViewReagraph: React.FC<GraphViewReagraphProps> = ({
  resp,
  query,
  height = 480,
  fillHeight = false,
}) => {
  const { t } = useTranslation()
  const theme = useTheme()
  // Reuse the existing element extractor so the same `resp` produces the
  // same element-set regardless of renderer. clusterByLabel / degreeSizing
  // are forced off in Phase 0 — they map to reagraph features that don't
  // exist yet.
  const { elements } = useGraphElements({
    resp,
    query,
    clusterByLabel: false,
    degreeSizing: false,
  })
  const { nodes, edges } = useMemo(
    () => toReagraphElements(elements, theme.variant),
    [elements, theme.variant]
  )
  // reagraph's Theme is a structured object with required fields on
  // node/edge/ring/arrow/lasso. Map our app theme tokens onto it. The
  // shape MUST match `Theme` from `reagraph/dist/themes/theme.d.ts` —
  // missing required fields would fail tsc. `theme.bg.graphCanvas` is
  // the dedicated dark/light surface used by the cytoscape canvas, so
  // labels and node fills already have known contrast against it.
  const reagraphTheme = useMemo(
    () => ({
      canvas: { background: theme.bg.graphCanvas },
      node: {
        fill: theme.text.muted,
        activeFill: theme.colors.primary,
        opacity: 1,
        selectedOpacity: 1,
        inactiveOpacity: 0.4,
        label: {
          color: theme.text.primary,
          stroke: theme.bg.graphCanvas,
          activeColor: theme.text.primary,
        },
      },
      ring: {
        fill: theme.border.subtle,
        activeFill: theme.colors.primary,
      },
      edge: {
        fill: theme.border.subtle,
        activeFill: theme.colors.primary,
        opacity: 1,
        selectedOpacity: 1,
        inactiveOpacity: 0.4,
        label: {
          color: theme.text.muted,
          stroke: theme.bg.graphCanvas,
          activeColor: theme.text.primary,
        },
      },
      arrow: {
        fill: theme.border.subtle,
        activeFill: theme.colors.primary,
      },
      lasso: {
        background: theme.bg.overlay,
        border: theme.colors.primary,
      },
    }),
    [theme]
  )
  const empty = nodes.length === 0
  const canvasHeight = fillHeight ? undefined : height
  return (
    <Wrap $fill={fillHeight} $sidebarCollapsed>
      <Canvas
        $height={canvasHeight}
        role="img"
        aria-label={t('graph.canvasAria')}
        data-testid="graph-canvas"
        data-renderer="reagraph"
      >
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          layoutType="forceDirected2d"
          theme={reagraphTheme}
        />
      </Canvas>
      {empty && (
        <Overlay data-testid="graph-empty-state">{t('graph.empty')}</Overlay>
      )}
    </Wrap>
  )
}
