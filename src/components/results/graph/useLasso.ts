import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import lasso from 'cytoscape-lasso'

cytoscape.use(lasso as unknown as cytoscape.Ext)

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
    const cy = cyRef.current as CoreWithLasso | null
    if (!cy || typeof cy.lassoSelectionEnabled !== 'function') return undefined
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
    return undefined
  }, [
    cyRef,
    enabled,
    restorePanningWhenDisabled,
    restoreBoxSelectionWhenDisabled,
    sig,
  ])
}
