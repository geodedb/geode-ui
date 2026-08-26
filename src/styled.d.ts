import 'styled-components'

import type { Theme } from '@geodedb/ui-core/theme'

declare module 'styled-components' {
  // The styled-components DefaultTheme is the union all `${({ theme }) => …}`
  // accessors are typed against. Extending it with our Theme contract makes
  // every styled component, every helper, and every test wrapper agree on
  // token shape — including the legacy flat aliases (colors.primary,
  // spacing.{xs..xl}) kept for backwards compatibility.
  // The "empty" interface is the point: declaration merging into the
  // module's DefaultTheme requires an interface, not a type alias.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends Theme {}
}
