// formatAuditTimestamp — render an ISO-8601 timestamp using the
// operator's browser locale + timezone defaults. Honours optional
// overrides for test fixtures and for a future "display options"
// panel.
//
// Why a dedicated helper:
//   • The audit log is the largest concentration of timestamps in
//     the SPA; we don't want every row to construct its own
//     DateTimeFormat (the constructor is expensive).
//   • Browser-default formatting answers the user's request directly
//     ("based on the user's default browser profile") — Intl already
//     reads navigator language + IANA timezone without any JS-side
//     plumbing.
//   • Invalid input gracefully passes through unchanged so a future
//     server-side schema break doesn't black-screen the page.

const FALLBACK_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

// Cache the formatter — DateTimeFormat construction is non-trivial,
// and most audit rows share the same locale+timezone.
const cache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(
  locale: string,
  timeZone: string | undefined
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone ?? ''}`
  let fmt = cache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      ...FALLBACK_OPTIONS,
      ...(timeZone ? { timeZone } : {}),
    })
    cache.set(key, fmt)
  }
  return fmt
}

export interface FormatAuditTimestampOptions {
  /** Defaults to undefined → Intl picks the browser default. */
  locale?: string
  /** Defaults to undefined → Intl picks the browser default. */
  timeZone?: string
}

export function formatAuditTimestamp(
  iso: string | undefined,
  options: FormatAuditTimestampOptions = {}
): string {
  if (typeof iso !== 'string' || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const locale = options.locale ?? 'default'
  return getFormatter(locale, options.timeZone).format(d)
}
