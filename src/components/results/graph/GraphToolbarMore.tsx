import React from 'react'
import { Dropdown, DropdownItem } from '../../../services/webawesome/components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphToolbarMoreProps = {
  t: TFn
  miniMap: boolean
  onToggleMiniMap: () => void
  lasso: boolean
  onToggleLasso: () => void
  domNodes: boolean
  onToggleDomNodes: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

// GraphToolbarMore is the graph toolbar's "More…" dropdown. It groups
// the rarely-used toggles (mini-map, lasso, HTML-nodes, sidebar
// collapse) behind a single trigger so the main toolbar row stays
// short.
//
// Each entry is a checkbox-style <wa-dropdown-item>; the `aria-checked`
// attribute reflects its bound pref. We attach `onClick` directly to
// each item so jsdom-based unit tests can fire it via fireEvent.click
// without relying on Lit's internal `wa-select` CustomEvent delivery.
// In real browsers the standard click event is exactly what Lit reads
// to drive the dropdown selection model too — no double-fire because
// the handler is idempotent in nature (it toggles a pref).
export const GraphToolbarMore: React.FC<GraphToolbarMoreProps> = ({
  t,
  miniMap,
  onToggleMiniMap,
  lasso,
  onToggleLasso,
  domNodes,
  onToggleDomNodes,
  sidebarCollapsed,
  onToggleSidebar,
}) => (
  <Dropdown data-testid="graph-toolbar-more" placement="bottom-end">
    <wa-button
      slot="trigger"
      appearance="outlined"
      size="s"
      data-testid="graph-toolbar-more-trigger"
    >
      {t('graph.moreLabel')}
    </wa-button>
    <DropdownItem
      type="checkbox"
      value="minimap"
      data-testid="graph-more-minimap"
      checked={miniMap || undefined}
      aria-checked={miniMap ? 'true' : 'false'}
      role="menuitemcheckbox"
      onClick={onToggleMiniMap}
    >
      {t('graph.miniMap')}
    </DropdownItem>
    <DropdownItem
      type="checkbox"
      value="lasso"
      data-testid="graph-more-lasso"
      checked={lasso || undefined}
      aria-checked={lasso ? 'true' : 'false'}
      role="menuitemcheckbox"
      onClick={onToggleLasso}
    >
      {t('graph.lasso')}
    </DropdownItem>
    <DropdownItem
      type="checkbox"
      value="domNodes"
      data-testid="graph-more-domnodes"
      checked={domNodes || undefined}
      aria-checked={domNodes ? 'true' : 'false'}
      role="menuitemcheckbox"
      onClick={onToggleDomNodes}
    >
      {t('graph.domNodes')}
    </DropdownItem>
    <DropdownItem
      type="checkbox"
      value="sidebar"
      data-testid="graph-more-sidebar"
      checked={sidebarCollapsed || undefined}
      aria-checked={sidebarCollapsed ? 'true' : 'false'}
      role="menuitemcheckbox"
      onClick={onToggleSidebar}
    >
      {t('graph.toggleSidebarFromMore')}
    </DropdownItem>
  </Dropdown>
)
