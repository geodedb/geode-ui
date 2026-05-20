import React from 'react'

// Typed Font Awesome Free wrapper. Centralises the icon vocabulary so
// a single rename (e.g. swap Free for Pro, or move a glyph) lands in
// one place instead of every call site.
//
// Library is loaded globally via `@fortawesome/fontawesome-free/css/
// all.min.css` in src/index.tsx — no per-icon registration needed.
// The CSS-mode setup is preferred over the SVG/JS injector because:
//   1. SSR-safe: pure CSS works without React mount;
//   2. CSP-safe: no runtime DOM injection (the JS injector adds
//      inline <svg> nodes that some strict CSPs flag);
//   3. WA shadow-DOM-safe: the `<i>` tag with class names paints
//      correctly inside wa-button slots without needing the FA SVG
//      JS to walk the shadow tree.

export type IconStyle = 'solid' | 'regular' | 'brands'

export interface IconProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  /**
   * Font Awesome icon slug (without the `fa-` prefix). Example: 'sun',
   * 'xmark', 'chevron-right'. Only Free-tier icons are supported.
   */
  name: string
  /**
   * Icon style. Defaults to 'solid' (the most commonly used variant
   * and the only one with full free-tier coverage). 'regular' is the
   * outlined variant; 'brands' is for logos.
   */
  variant?: IconStyle
  /**
   * Fixed width — when true the icon reserves a uniform width so a
   * row of icons aligns even when individual glyphs have different
   * intrinsic widths (e.g. a chevron next to a bars). Maps to
   * Font Awesome's `fa-fw` utility class.
   */
  fixedWidth?: boolean
  /**
   * Spin animation — useful for loading/refresh icons.
   */
  spin?: boolean
  /**
   * Accessible label. When omitted the icon is rendered as decorative
   * (aria-hidden); pair the call site with a text label or a
   * visually-hidden span if the icon is the sole affordance. Setting
   * a label here promotes the icon to role="img" with aria-label,
   * which is the standard pattern for icon-only buttons.
   */
  label?: string
}

const VARIANT_CLASS: Record<IconStyle, string> = {
  solid: 'fa-solid',
  regular: 'fa-regular',
  brands: 'fa-brands',
}

/**
 * Icon — typed Font Awesome Free wrapper.
 *
 * Usage:
 * ```tsx
 * <Icon name="sun" />                       // decorative
 * <Icon name="xmark" label="Close" />      // accessible
 * <Icon name="chevron-right" variant="solid" fixedWidth />
 * ```
 *
 * Inside a wa-button slot:
 * ```tsx
 * <wa-button>
 *   <Icon name="plus" slot="start" />
 *   Add user
 * </wa-button>
 * ```
 */
export const Icon: React.FC<IconProps> = ({
  name,
  variant = 'solid',
  fixedWidth,
  spin,
  label,
  className,
  ...rest
}) => {
  const classes = [
    VARIANT_CLASS[variant],
    `fa-${name}`,
    fixedWidth ? 'fa-fw' : '',
    spin ? 'fa-spin' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': 'true' as const }

  return <i className={classes} {...a11y} {...rest} />
}
