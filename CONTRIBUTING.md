# Contributing to ui

Thank you for your interest in contributing to ui! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Set up the development environment:

```bash
# All dependencies are public on the default npm registry.
npm install
make pre-commit-install
make dev
```

## Reporting Bugs

Before submitting a bug report:

1. Check existing issues to avoid duplicates
2. Use the bug report template when creating a new issue
3. Include:
   - Node.js version (`node --version`)
   - npm version (`npm --version`)
   - Browser and version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable

## Security Vulnerabilities

**Do not report security vulnerabilities through public issues.**

See [SECURITY.md](SECURITY.md) for responsible disclosure procedures.

## Feature Requests

1. Check existing issues for similar requests
2. Use the feature request template
3. Describe the use case and expected behavior
4. Consider implementation complexity

## Submitting Changes

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding/updating tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Maintenance tasks

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear, atomic commits
3. Ensure all checks pass: `make ci`
4. Update documentation if needed
5. Submit a merge request with:
   - Clear description of changes
   - Reference to related issues
   - Test coverage for new code

### Code Style

- Follow the project ESLint and Prettier configuration
- Use TypeScript with strict mode
- Use styled-components with theme tokens (no hard-coded styles)
- Write descriptive variable and function names
- Use arrow function components

### Testing Requirements

- All new features must have tests
- Maintain or improve test coverage
- Tests must pass in CI

```bash
make ci
```

## Code Review

All submissions require review. We aim to:

- Respond to MRs within 48 hours
- Provide constructive feedback
- Merge approved changes promptly

## Development Workflow

```bash
# Quick development iteration
make dev

# Full validation before pushing
make ci

# Run specific checks
make lint
make test
make typecheck
```

## Questions?

- Open a discussion issue
- See [SUPPORT.md](SUPPORT.md) for support options

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
