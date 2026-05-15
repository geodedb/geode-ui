import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import cxtmenu from 'cytoscape-cxtmenu'
import type { Theme } from '@/theme/types'

cytoscape.use(cxtmenu as unknown as cytoscape.Ext)

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type CxtMenuHandlers = {
  onZoomTo: (id: string) => void
  onExpand: (id: string) => void
  onHide: (id: string) => void
  onCollapse: (id: string) => void
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onCopyId: (id: string) => void
}

export type CxtMenuCommand = {
  id: string
  content: string
  select: (ele: { id: () => string }) => void
}

export function buildCommands(args: {
  handlers: CxtMenuHandlers
  t: TFn
}): CxtMenuCommand[] {
  const { handlers, t } = args
  return [
    {
      id: 'zoomTo',
      content: t('graph.menuZoomTo'),
      select: (e) => handlers.onZoomTo(e.id()),
    },
    {
      id: 'expand',
      content: t('graph.menuExpand'),
      select: (e) => handlers.onExpand(e.id()),
    },
    {
      id: 'hide',
      content: t('graph.actionHide'),
      select: (e) => handlers.onHide(e.id()),
    },
    {
      id: 'collapse',
      content: t('graph.actionCollapse'),
      select: (e) => handlers.onCollapse(e.id()),
    },
    {
      id: 'focus',
      content: t('graph.menuFocus'),
      select: (e) => handlers.onFocus(e.id()),
    },
    {
      id: 'pin',
      content: t('graph.menuPin'),
      select: (e) => handlers.onPin(e.id()),
    },
    {
      id: 'copyId',
      content: t('graph.menuCopyId'),
      select: (e) => handlers.onCopyId(e.id()),
    },
  ]
}

type CoreWithCxt = Core & {
  cxtmenu: (opts: unknown) => { destroy: () => void }
}

export type UseCxtMenuArgs = {
  cyRef: React.MutableRefObject<Core | null>
  handlers: CxtMenuHandlers
  t: TFn
  /**
   * Theme passed through from the consumer (typically `useTheme()`).
   * The radial menu draws onto a separate canvas overlay and cannot
   * read styled-components context itself, so it must be told the
   * relevant colors at mount time. Cosmetic options (fills, label
   * colors) are sourced from theme tokens to satisfy the
   * lint:hardcoded-styles guard.
   */
  theme: Theme
  sig?: string
  /**
   * When false, the hook is a no-op (no cxtmenu factory call, no
   * polling, no listener bind). Used by the scaleTier feature-gate
   * pipeline so the radial menu degrades off at large graph sizes.
   * Defaults to true to preserve callers that don't gate.
   */
  enabled?: boolean
}

export function useCxtMenu(args: UseCxtMenuArgs): void {
  const { cyRef, handlers, t, theme, sig, enabled = true } = args
  useEffect(() => {
    if (!enabled) return undefined
    // useGraphCytoscape's rebuild is debounced via setTimeout, so when
    // sig changes this effect runs BEFORE the new cy is constructed and
    // cyRef.current is null. A simple !cyRef.current return-early would
    // miss the cxtmenu factory call forever. Poll instead until cy is
    // mounted (or the effect is torn down).
    let mounted: { destroy: () => void } | null = null
    let cancelled = false
    const tryMount = (): void => {
      if (cancelled || mounted) return
      const cy = cyRef.current as CoreWithCxt | null
      if (!cy || typeof cy.cxtmenu !== 'function') {
        // Re-check after the debounced build is likely to have run.
        setTimeout(tryMount, 50)
        return
      }
      mounted = cy.cxtmenu({
        selector: 'node',
        openMenuEvents: 'cxttap taphold',
        commands: buildCommands({ handlers, t }),
        fillColor: theme.bg.inverse,
        activeFillColor: theme.colors.primary,
        activePadding: 4,
        indicatorSize: 18,
        separatorWidth: 2,
        spotlightPadding: 4,
        minSpotlightRadius: 18,
        maxSpotlightRadius: 36,
        itemColor: theme.text.inverse,
        itemTextShadowColor: 'transparent',
        zIndex: 9999,
      })
    }
    tryMount()
    return () => {
      cancelled = true
      if (mounted) {
        try {
          mounted.destroy()
        } catch {
          // cy may already be destroyed during rebuild teardown.
        }
      }
    }
    // handlers + t identities churn each render; re-mounting cxtmenu
    // every render would tear down the menu DOM at React's cadence.
    // The handlers captured at sig-time read latest state via zustand/refs.
    // (Project does not enable react-hooks/exhaustive-deps, so no disable
    // directive is needed; the rule is unloaded and would itself error.)
  }, [cyRef, sig, enabled])
}
