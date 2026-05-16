// useGraphDomNodeRoots — owns the per-node React-root pool that backs
// the cytoscape-dom-node renderer.
//
// When the user enables the HTML-nodes toggle, useDomNodes calls our
// `renderNode(data)` for each node and expects an HTMLElement back. We
// give it a fresh <div>, mount a React root onto it, render
// <CustomNodeTemplate/>, and stash the root keyed by node id so the
// effect-cleanup pass can unmount every root on rebuild/unmount. Without
// the cleanup, every cytoscape teardown leaks N mounted createRoot()
// instances — they outlive the underlying nodes because nothing else
// points at them.
//
// QUALITY #164: extracted from GraphViewCytoscape so the orchestrator
// doesn't carry the React-root bookkeeping inline.

import React, { useCallback, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider, type DefaultTheme } from 'styled-components'
import { labelToColor } from '../cytoscapeStyle'
import { CustomNodeTemplate } from './CustomNodeTemplate'

export type GraphDomNodePinning = { isPinned: (id: string) => boolean }

export type GraphDomNodeRoots = {
  // The renderNode callback consumed by useDomNodes. Returns a fresh
  // HTMLElement each call; the per-id root is recorded so the effect
  // cleanup below tears them all down on `sig` change / unmount.
  renderNode: (data: Record<string, unknown>) => HTMLElement
}

export function useGraphDomNodeRoots(opts: {
  theme: DefaultTheme
  pinning: GraphDomNodePinning
  // sig is the rebuild key (forwarded from the orchestrator) — when it
  // changes, every mounted root is unmounted so a fresh cytoscape core
  // doesn't inherit stale React trees.
  sig: string
}): GraphDomNodeRoots {
  const { theme, pinning, sig } = opts
  const domRootsRef = useRef<Map<string, Root>>(new Map())

  const renderNode = useCallback(
    (data: Record<string, unknown>): HTMLElement => {
      const labelField = data.label
      let label = ''
      if (typeof labelField === 'string') {
        label = labelField
      } else if (
        Array.isArray(labelField) &&
        typeof labelField[0] === 'string'
      ) {
        label = labelField[0]
      }
      const swatchColor = labelToColor(label, theme.variant)
      const id = data.id != null ? String(data.id) : ''
      const pinned = id ? pinning.isPinned(id) : false
      const container = document.createElement('div')
      const root = createRoot(container)
      root.render(
        <ThemeProvider theme={theme}>
          <CustomNodeTemplate
            label={label}
            swatchColor={swatchColor}
            pinned={pinned}
          />
        </ThemeProvider>
      )
      if (id) {
        const prev = domRootsRef.current.get(id)
        if (prev) prev.unmount()
        domRootsRef.current.set(id, root)
      }
      return container
    },
    [pinning, theme]
  )

  // Tear down every mounted root on unmount or sig change so a fresh
  // cytoscape core doesn't leak the previous run's React trees.
  useEffect(() => {
    const roots = domRootsRef.current
    return () => {
      roots.forEach((root) => {
        try {
          root.unmount()
        } catch {
          /* already unmounted */
        }
      })
      roots.clear()
    }
  }, [sig])

  return { renderNode }
}
