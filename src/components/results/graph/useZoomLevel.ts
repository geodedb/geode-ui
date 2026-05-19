import { useCallback, useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

// Slider domain is 0..1; cy.zoom() domain is [ZOOM_MIN..ZOOM_MAX] on a
// LOG scale so equal slider distances feel like equal perceptual zoom
// steps (10x → 1x → 0.1x covers the same UI travel as the inverse).
const ZOOM_MIN = 0.1
const ZOOM_MAX = 10

function levelFromZoom(z: number): number {
  const log = Math.log10(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))
  // log range: log10(0.1)..log10(10) = -1..1 → map to 0..1
  return (log + 1) / 2
}
function zoomFromLevel(level: number): number {
  const clamped = Math.min(1, Math.max(0, level))
  return 10 ** (clamped * 2 - 1)
}

export type UseZoomLevelResult = {
  level: number // 0..1
  setZoomLevel: (level: number) => void
}

export function useZoomLevel(
  cyRef: React.MutableRefObject<Core | null>,
  sig: string
): UseZoomLevelResult {
  const [level, setLevel] = useState(0.5)

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return undefined
    setLevel(levelFromZoom(cy.zoom()))
    const onZoom = (): void => setLevel(levelFromZoom(cy.zoom()))
    cy.on('zoom', onZoom)
    return () => {
      try {
        cy.off('zoom', onZoom)
      } catch {
        /* cy may already be destroyed; ignore */
      }
    }
  }, [cyRef, sig])

  const setZoomLevel = useCallback(
    (next: number): void => {
      const cy = cyRef.current
      if (!cy) return
      cy.zoom({
        level: zoomFromLevel(next),
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      })
    },
    [cyRef]
  )

  return { level, setZoomLevel }
}
