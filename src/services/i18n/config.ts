// i18n bootstrap.
//
// Pattern adopted from ../brancher/brancher's
// src/services/i18n/config.ts (see CLAUDE.md i18n guidelines):
//   • Single 'translation' namespace, nested by domain.
//   • Plural rules via the intl-pluralrules polyfill so older
//     browsers / Electron's Chromium build behave consistently.
//   • Browser language detector reads navigator.language +
//     localStorage('app_language') so the user's switch persists.
//
// The detector falls through to `fallbackLng: 'en'` when a requested
// language isn't in SUPPORTED_LANGUAGES yet — adding a locale
// (e.g. de) only needs a new file under locales/ and a
// SUPPORTED_LANGUAGES entry; init resolves automatically.

import 'intl-pluralrules'
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import { RESOURCES, SUPPORTED_LANGUAGES } from './locales'

const STORAGE_KEY = 'geode.ui.language'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: RESOURCES,
    fallbackLng: 'en',
    supportedLngs: Object.keys(SUPPORTED_LANGUAGES),
    ns: ['translation'],
    defaultNS: 'translation',
    nsSeparator: ':',
    keySeparator: '.',
    interpolation: {
      // React already escapes per-render; double-escaping here would
      // mangle ampersands and quotes inside translated strings.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
    returnNull: false,
  })

export { STORAGE_KEY as I18N_STORAGE_KEY }
export default i18n
