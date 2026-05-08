import React from 'react'
import { useTranslation } from 'react-i18next'

import i18n, { I18N_STORAGE_KEY } from './config'
import {
  SUPPORTED_LANGUAGES,
  type LanguageDescriptor,
  type SupportedLanguage,
} from './locales'

interface LocalizationContextValue {
  language: SupportedLanguage
  isRTL: boolean
  isSystemLanguage: boolean
  setLanguage: (language: SupportedLanguage | null) => void
  supportedLanguages: typeof SUPPORTED_LANGUAGES
  // Locale-aware formatters. Built on Intl.* so the browser handles
  // BCP 47 fallback chains automatically (en-GB → en).
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatCurrency: (
    value: number,
    currency: string,
    options?: Intl.NumberFormatOptions
  ) => string
  formatDate: (
    date: Date | number | string,
    options?: Intl.DateTimeFormatOptions
  ) => string
  formatRelativeTime: (date: Date | number | string) => string
  formatPercent: (value: number, decimals?: number) => string
  decimalSeparator: string
  thousandsSeparator: string
}

const LocalizationContext =
  React.createContext<LocalizationContextValue | null>(null)

function isSupported(
  code: string | null | undefined
): code is SupportedLanguage {
  return !!code && code in SUPPORTED_LANGUAGES
}

function detectInitial(): { language: SupportedLanguage; isSystem: boolean } {
  if (typeof window === 'undefined') return { language: 'en', isSystem: true }
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(I18N_STORAGE_KEY)
  } catch {
    // SecurityError under sandboxed Electron — fall through to
    // navigator-based detection.
  }
  if (isSupported(stored)) return { language: stored, isSystem: false }
  const navLang = window.navigator.language?.split('-')[0]
  if (isSupported(navLang)) return { language: navLang, isSystem: true }
  return { language: 'en', isSystem: true }
}

function locale(language: SupportedLanguage): string {
  // i18next stores the active code under `i18n.language` after init —
  // it may include region (e.g. 'en-GB'). Use whichever is most
  // specific so Intl.* picks the right CLDR data.
  return i18n.language && i18n.language.startsWith(language)
    ? i18n.language
    : language
}

function separators(language: SupportedLanguage): {
  decimal: string
  thousands: string
} {
  const parts = new Intl.NumberFormat(locale(language)).formatToParts(1234.5)
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const thousands = parts.find((p) => p.type === 'group')?.value ?? ','
  return { decimal, thousands }
}

const RELATIVE_THRESHOLDS: Array<{
  unit: Intl.RelativeTimeFormatUnit
  ms: number
}> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
]

function relativeTime(
  target: Date | number | string,
  lang: SupportedLanguage
): string {
  const t =
    typeof target === 'object' ? target.getTime() : new Date(target).getTime()
  const diff = t - Date.now()
  const absDiff = Math.abs(diff)
  const fmt = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' })
  const match = RELATIVE_THRESHOLDS.find((threshold) => absDiff >= threshold.ms)
  if (match) {
    return fmt.format(Math.round(diff / match.ms), match.unit)
  }
  return fmt.format(0, 'second')
}

export const LocalizationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const initial = detectInitial()
  const [language, setLanguageState] = React.useState<SupportedLanguage>(
    initial.language
  )
  const [isSystemLanguage, setIsSystem] = React.useState<boolean>(
    initial.isSystem
  )

  // Keep i18next in sync with the React state. i18n.changeLanguage()
  // is a no-op when the active language already matches.
  React.useEffect(() => {
    i18n.changeLanguage(language)
  }, [language])

  const setLanguage = React.useCallback((next: SupportedLanguage | null) => {
    if (next === null) {
      // Reset to system detection.
      try {
        window.localStorage.removeItem(I18N_STORAGE_KEY)
      } catch {
        /* ignore — state still updates locally */
      }
      const detected = detectInitial()
      setLanguageState(detected.language)
      setIsSystem(true)
      return
    }
    if (!isSupported(next)) return
    try {
      window.localStorage.setItem(I18N_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    setLanguageState(next)
    setIsSystem(false)
  }, [])

  const descriptor: LanguageDescriptor = SUPPORTED_LANGUAGES[language]

  const value = React.useMemo<LocalizationContextValue>(() => {
    const lang = language
    const seps = separators(lang)
    return {
      language: lang,
      isRTL: descriptor.rtl === true,
      isSystemLanguage,
      setLanguage,
      supportedLanguages: SUPPORTED_LANGUAGES,
      formatNumber: (value, options) =>
        new Intl.NumberFormat(locale(lang), options).format(value),
      formatCurrency: (value, currency, options) =>
        new Intl.NumberFormat(locale(lang), {
          style: 'currency',
          currency,
          ...options,
        }).format(value),
      formatDate: (date, options) => {
        const d =
          typeof date === 'string' || typeof date === 'number'
            ? new Date(date)
            : date
        return new Intl.DateTimeFormat(locale(lang), options).format(d)
      },
      formatRelativeTime: (date) => relativeTime(date, lang),
      formatPercent: (value, decimals = 0) =>
        new Intl.NumberFormat(locale(lang), {
          style: 'percent',
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value),
      decimalSeparator: seps.decimal,
      thousandsSeparator: seps.thousands,
    }
  }, [descriptor.rtl, isSystemLanguage, language, setLanguage])

  // Sync html lang + dir so screen readers + browser spellcheck pick
  // up the active locale.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('lang', language)
    document.documentElement.setAttribute(
      'dir',
      descriptor.rtl === true ? 'rtl' : 'ltr'
    )
  }, [language, descriptor.rtl])

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  )
}

export function useLocalization(): LocalizationContextValue {
  const ctx = React.useContext(LocalizationContext)
  if (!ctx) {
    throw new Error(
      'useLocalization must be used inside <LocalizationProvider>'
    )
  }
  return ctx
}

// Convenience hook combining t() with the localization context — same
// shape as brancher's useAppTranslation().
export function useAppTranslation(): {
  t: ReturnType<typeof useTranslation>['t']
} & LocalizationContextValue {
  const { t } = useTranslation()
  const localization = useLocalization()
  return { t, ...localization }
}
