# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public issues.**

Instead, please report them via email to: <security@codepros.dev>

Please include:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** assessment
4. **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution Timeline**: Depends on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next release cycle

### Disclosure Policy

- We follow responsible disclosure practices
- Security advisories will be published after fixes are available
- Credit will be given to reporters (unless anonymity is requested)

## Security Measures

This project implements:

- **Dependency Scanning**: Automated security scanning in CI
- **Secret Detection**: Gitleaks scanning for leaked credentials
- **SAST**: Static application security testing
- **DOMPurify**: HTML sanitization via `@devnw/components`
- **RBAC**: Deny-by-default authorization via `@devnw/components`
- **CSP-ready**: No inline event handlers or unsafe patterns

## Security Best Practices

When developing with this template:

1. Keep dependencies updated (`npm audit`)
2. Never commit secrets or tokens
3. Use environment variables for sensitive configuration
4. Sanitize user input before rendering
5. Use the RBAC system for authorization
6. External links must use `rel="noopener noreferrer"`

## Contact

For non-security issues, see [SUPPORT.md](SUPPORT.md).
