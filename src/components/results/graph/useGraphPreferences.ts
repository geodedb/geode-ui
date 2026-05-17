import { useCallback } from 'react'
import { useGraphPrefs } from '../useGraphPrefs'
import { allowedFeatures } from './scaleTier'

// useGraphPreferences hoists every useGraphPrefs(...) selector pair
// the orchestrator used to inline at the top of its body (QUAL #164).
// Returning a single object keeps the orchestrator's destructure
// readable; the surface is intentionally wide because the prefs
// store IS the orchestrator's vocabulary. Tier-derived flags
// (cxtMenu, tooltips, badges, domNodes-with-tier-gate) are returned
// already-resolved so the orchestrator never branches on `tier`.
//
// The return type is inferred -- the wide surface is fine because
// every consumer destructures specific keys and TypeScript can flow
// each one through; adding/removing a pref bubbles up to callers as
// a missing-property error.
export function useGraphPreferences() {
  const layout = useGraphPrefs((s) => s.layout)
  const setLayout = useGraphPrefs((s) => s.setLayout)
  const nodeLabelPrefs = useGraphPrefs((s) => s.nodeLabelPrefs)
  const setNodeLabelPref = useGraphPrefs((s) => s.setNodePref)
  const edgeLabelPrefs = useGraphPrefs((s) => s.edgeLabelPrefs)
  const setEdgeLabelPref = useGraphPrefs((s) => s.setEdgePref)
  const hiddenLabels = useGraphPrefs((s) => s.hiddenLabels)
  const toggleHiddenLabel = useGraphPrefs((s) => s.toggleHiddenLabel)
  const setHiddenLabels = useGraphPrefs((s) => s.setHiddenLabels)
  const inspectorView = useGraphPrefs((s) => s.inspectorView)
  const setInspectorView = useGraphPrefs((s) => s.setInspectorView)
  const selectionMode = useGraphPrefs((s) => s.selectionMode)
  const setSelectionMode = useGraphPrefs((s) => s.setSelectionMode)
  const clusterByLabel = useGraphPrefs((s) => s.clusterByLabel)
  const setClusterByLabel = useGraphPrefs((s) => s.setClusterByLabel)
  const degreeSizing = useGraphPrefs((s) => s.degreeSizing)
  const setDegreeSizing = useGraphPrefs((s) => s.setDegreeSizing)
  const miniMap = useGraphPrefs((s) => s.miniMap)
  const setMiniMap = useGraphPrefs((s) => s.setMiniMap)
  const lasso = useGraphPrefs((s) => s.lasso)
  const setLasso = useGraphPrefs((s) => s.setLasso)
  const domNodes = useGraphPrefs(
    (s) => s.domNodes && allowedFeatures(s.tier).domNodes
  )
  const setDomNodes = useGraphPrefs((s) => s.setDomNodes)
  const cxtMenuEnabled = useGraphPrefs((s) => allowedFeatures(s.tier).cxtmenu)
  const tooltipsEnabled = useGraphPrefs((s) => allowedFeatures(s.tier).tooltips)
  const badgesEnabled = useGraphPrefs((s) => allowedFeatures(s.tier).badges)
  const renderer = useGraphPrefs((s) => s.renderer)
  const setRenderer = useGraphPrefs((s) => s.setRenderer)
  // onToggleRenderer hoisted into a callback so the GraphToolbar JSX
  // does not need an arrow-with-implicit-return -- prettier wants the
  // body on its own line, eslint's react/jsx-curly-newline rule
  // forbids the resulting newline before `}`. Easier to lift the
  // handler than to fight the two rules in a single expression.
  const onToggleRenderer = useCallback(() => {
    setRenderer(renderer === 'reagraph' ? 'cytoscape' : 'reagraph')
  }, [renderer, setRenderer])
  const sectionsOpen = useGraphPrefs((s) => s.sectionsOpen)
  const toggleSection = useGraphPrefs((s) => s.toggleSection)
  const focusHops = useGraphPrefs((s) => s.focusHops)
  const setFocusHops = useGraphPrefs((s) => s.setFocusHops)
  return {
    layout,
    setLayout,
    nodeLabelPrefs,
    setNodeLabelPref,
    edgeLabelPrefs,
    setEdgeLabelPref,
    hiddenLabels,
    toggleHiddenLabel,
    setHiddenLabels,
    inspectorView,
    setInspectorView,
    selectionMode,
    setSelectionMode,
    clusterByLabel,
    setClusterByLabel,
    degreeSizing,
    setDegreeSizing,
    miniMap,
    setMiniMap,
    lasso,
    setLasso,
    domNodes,
    setDomNodes,
    cxtMenuEnabled,
    tooltipsEnabled,
    badgesEnabled,
    renderer,
    setRenderer,
    onToggleRenderer,
    sectionsOpen,
    toggleSection,
    focusHops,
    setFocusHops,
  }
}
