// Platform-aware keyboard glyphs for user-facing hotkey hints.
//
// GAP-047: the SPA used to hardcode "⌘" / "⇧" in hint strings
// (`query.runHotkey`, `query.formatHotkey`), but the Monaco bindings
// underneath accept both Cmd+Enter (mac) and Ctrl+Enter (Linux/Win) —
// so the hint was *wrong* on the majority of platforms (~70% of likely
// viewers are Linux/Windows) even though the binding worked. This
// module is the single seam every hotkey hint must funnel through.
//
// Why a separate module: a CI ratchet (scripts/check-no-mac-glyphs.mjs,
// wired into .pre-commit-config.yaml) refuses any "⌘" / "⌥" / "⇧"
// outside this file, so a future contributor cannot reintroduce the
// regression by typing the glyph into a fresh string literal.

// `UserAgentData.platform` is the modern Chromium / Edge surface; it's
// not in the `lib.dom.d.ts` typings yet so we narrow inline. Safari /
// older browsers fall back to the deprecated `navigator.platform`.
interface NavigatorUAData {
  platform?: string
}
interface NavigatorWithUAData {
  userAgentData?: NavigatorUAData
  platform?: string
}

function isMacPlatform(nav: NavigatorWithUAData | undefined): boolean {
  if (!nav) return false
  const ua = nav.userAgentData?.platform ?? nav.platform ?? ''
  // userAgentData.platform reports "macOS"; navigator.platform reports
  // strings like "MacIntel", "Mac68K", "MacPPC" — match the case-
  // insensitive prefix.
  return /^mac/i.test(ua)
}

// modKeyLabel — the label for the "command/control" modifier key on
// the active platform. mac users see "⌘"; everyone else sees "Ctrl".
//
// Pure function with an injectable `nav` argument so the unit tests can
// stub the platform without touching `globalThis`. Production callers
// pass nothing and pick up the live `navigator`.
export function modKeyLabel(
  nav: NavigatorWithUAData | undefined = typeof navigator !== 'undefined'
    ? (navigator as NavigatorWithUAData)
    : undefined
): string {
  return isMacPlatform(nav) ? '⌘' : 'Ctrl'
}

// shiftKeyLabel — "⇧" on mac, "Shift" on Linux/Windows. The Monaco
// binding for textDocument/formatting is Cmd+Shift+F / Ctrl+Shift+F;
// pre-fix the hint read "⌘⇧F" everywhere, which is doubly wrong on a
// Windows machine (no Cmd key, ⇧ is not a Windows convention).
export function shiftKeyLabel(
  nav: NavigatorWithUAData | undefined = typeof navigator !== 'undefined'
    ? (navigator as NavigatorWithUAData)
    : undefined
): string {
  return isMacPlatform(nav) ? '⇧' : 'Shift'
}
