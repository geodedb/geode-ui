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
  sig?: string
}

// Wire cytoscape-lasso enable-state to a reactive prop. When `enabled`
// flips to true the user can drag a freeform shape on the canvas to
// area-select nodes. Sig-keyed re-apply so a fresh cy core after a
// rebuild reflects the current pref.
export function useLasso(args: UseLassoArgs): void {
  const { cyRef, enabled, sig } = args
  useEffect(() => {
    const cy = cyRef.current as CoreWithLasso | null
    if (!cy || typeof cy.lassoSelectionEnabled !== 'function') return
    cy.lassoSelectionEnabled(enabled)
  }, [cyRef, enabled, sig])
}
