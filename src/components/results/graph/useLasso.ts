import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'

// PERF #316: lazy-load cytoscape-lasso so users who never toggle the
// lasso pref pay zero bytes for it. Same pattern as useCxtMenu — a
// single module-level promise caches the import + cytoscape.use()
// registration; first-enable pays the import cost, subsequent calls
// resolve immediately.
let lassoPluginPromise: Promise<void> | null = null
function ensureLassoPlugin(): Promise<void> {
  if (!lassoPluginPromise) {
    lassoPluginPromise = import(
      /* webpackChunkName: "cyto-lasso" */ 'cytoscape-lasso'
    ).then((mod: { default: unknown }) => {
      cytoscape.use(mod.default as unknown as cytoscape.Ext)
    })
  }
  return lassoPluginPromise
}

type CoreWithLasso = Core & {
  lassoSelectionEnabled: (on?: boolean) => unknown
}

export type UseLassoArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
  // When provided, useLasso restores this panning state when lasso
  // turns off — so we don't strand the user in box-selection mode
  // after they disable lasso. Defaults to true (pan enabled).
  restorePanningWhenDisabled?: boolean
  // Same idea for box-selection: cytoscape-lasso reuses the
  // boxSelectionEnabled-on draw path, so we force it on while lasso
  // is active and restore the caller's prior choice on disable.
  restoreBoxSelectionWhenDisabled?: boolean
  sig?: string
}

// Wire cytoscape-lasso enable-state to a reactive prop. When `enabled`
// flips to true the user can drag a freeform shape on the canvas to
// area-select nodes. Sig-keyed re-apply so a fresh cy core after a
// rebuild reflects the current pref.
//
// Bug 6: cytoscape-lasso's README says "if enabled along with panning,
// the user must hold down shift/ctrl/cmd to initiate lasso selection."
// In practice every user who toggled the Lasso button expected
// click-and-drag to lasso-select immediately. Without the modifier
// the drag pans the canvas instead, so lasso "doesn't seem to do
// anything"; flipping lasso on AND off then leaves the cy core in a
// weird half-state where box selection is enabled but lasso isn't —
// the user reports this as "Lasso breaks the graph view". Disable
// userPanningEnabled and enable boxSelectionEnabled while lasso is
// active so a plain click-drag draws the lasso polygon; restore both
// to caller-chosen defaults when lasso turns off.
export function useLasso(args: UseLassoArgs): void {
  const {
    cyRef,
    enabled,
    restorePanningWhenDisabled = true,
    restoreBoxSelectionWhenDisabled = false,
    sig,
  } = args
  useEffect(() => {
    let cancelled = false
    // PERF #316: when the lasso pref is on, await the lazy plugin
    // chunk + registration before touching the cy methods. When the
    // pref is OFF we don't need the plugin loaded at all — the
    // `cy.lassoSelectionEnabled` no-op safety check below still
    // succeeds for the "OFF" branch because the cy methods that were
    // installed by a prior on→off transition are still in place, and
    // a never-enabled lasso has nothing to disable. This keeps the
    // common case (lasso pref never flipped) at zero plugin cost.
    const apply = (): void => {
      if (cancelled) return
      const cy = cyRef.current as CoreWithLasso | null
      if (!cy || typeof cy.lassoSelectionEnabled !== 'function') return
      if (enabled) {
        // Order matters: disable panning BEFORE enabling lasso so the
        // plugin's drag handler captures the next mousedown without
        // racing the pan handler.
        cy.userPanningEnabled(false)
        cy.boxSelectionEnabled(true)
        cy.lassoSelectionEnabled(true)
      } else {
        cy.lassoSelectionEnabled(false)
        cy.userPanningEnabled(restorePanningWhenDisabled)
        cy.boxSelectionEnabled(restoreBoxSelectionWhenDisabled)
      }
    }
    if (enabled) {
      ensureLassoPlugin().then(apply, () => {
        // Plugin failed to load — leave panning/box-selection in
        // their current state and bail. The user can re-toggle to
        // retry (next ensureLassoPlugin() call returns the cached
        // rejected promise, but a manual fix would reset the cache).
      })
    } else {
      // Disable path doesn't need the plugin loaded — if `cy.lasso*`
      // is missing the apply() function is a no-op via the type-guard.
      apply()
    }
    return () => {
      cancelled = true
    }
  }, [
    cyRef,
    enabled,
    restorePanningWhenDisabled,
    restoreBoxSelectionWhenDisabled,
    sig,
  ])
}
