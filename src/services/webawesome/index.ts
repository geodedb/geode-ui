// Web Awesome foundation + component registration.
//
// 1. Import the core stylesheet (provides resets, custom-property
//    defaults, and base utility classes WA components rely on).
// 2. Import the default theme stylesheet (provides the baseline
//    --wa-* token values that our ThemeStyleSheet then overrides
//    via the theme-bridge).
// 3. Side-effect imports for each component register the custom
//    elements via customElements.define().
//
// Components are imported EXPLICITLY (not via the autoloader) so
// bundle size stays predictable. Add new component imports here
// when migrating additional surfaces.

import '@awesome.me/webawesome/dist/styles/webawesome.css'
import '@awesome.me/webawesome/dist/styles/themes/default.css'

import '@awesome.me/webawesome/dist/components/button/button.js'
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/option/option.js'
import '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js'
import '@awesome.me/webawesome/dist/components/tab/tab.js'
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js'
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js'
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js'
