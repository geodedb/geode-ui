require('@testing-library/jest-dom')
// Ensure the i18n instance initializes once for every test file. Tests
// that don't render under <LocalizationProvider> still call useTranslation()
// inside Shell, LoginPage, etc. — without this side-effect import the
// hook would render raw keys like "common.skipToMain" instead of the
// translated strings.
require('../src/services/i18n/config')
