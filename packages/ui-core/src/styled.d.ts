import 'styled-components'

import type { Theme } from './theme/types'

declare module 'styled-components' {
  // The styled-components DefaultTheme is the union all `${({ theme }) => …}`
  // accessors are typed against. Extending it with our Theme contract makes
  // every styled component, every helper, and every test wrapper agree on
  // token shape — including the legacy flat aliases (colors.primary,
  // spacing.{xs..xl}) kept for backwards compatibility.
  export interface DefaultTheme extends Theme {}
}
