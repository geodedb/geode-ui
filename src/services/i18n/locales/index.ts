// Locale registry.
//
// Add a new language by:
//   1. Creating src/services/i18n/locales/<bcp47>.ts that exports a
//      const matching the shape of `en.ts` (the Translations type
//      enforces this).
//   2. Re-exporting it here.
//   3. Listing it in SUPPORTED_LANGUAGES below so the user-facing
//      language picker knows about it.
//   4. Running `pnpm verify:translations` to confirm key parity.

import { en } from './en'

export type SupportedLanguage = 'en'

export interface LanguageDescriptor {
  code: SupportedLanguage
  /** Endonym — the language's name in its own language. */
  name: string
  /** Right-to-left script (Arabic, Hebrew, etc.). */
  rtl?: boolean
}

export const SUPPORTED_LANGUAGES: Record<
  SupportedLanguage,
  LanguageDescriptor
> = {
  en: { code: 'en', name: 'English' },
}

export const RESOURCES: Record<SupportedLanguage, { translation: typeof en }> =
  {
    en: { translation: en },
  }

export { en } from './en'
export type { Translations } from './en'
