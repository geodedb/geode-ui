# ui - React Application Makefile
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2024-2025 CodePros

.PHONY: all build test dev ci clean lint fmt help
.PHONY: pre-commit-install pre-commit pre-commit-run

# Default target: lint and test
all: lint test
	@echo "All checks passed!"

# Start development server
dev:
	@echo "Starting development server..."
	@npm start

# Production build
build:
	@echo "Building ui..."
	@npm run build

# Run all tests
test:
	@echo "Running tests..."
	@npm test -- --ci

# Run tests in watch mode
test-watch:
	@echo "Starting test watcher..."
	@npm run test:watch

# TypeScript type checking
typecheck:
	@echo "Checking types..."
	@npm run test:ts

# Run linter
lint:
	@echo "Linting..."
	@npm run lint

# Fix lint issues
lint-fix:
	@echo "Fixing lint issues..."
	@npm run lint:fix

# Format code
fmt:
	@echo "Formatting code..."
	@npm run prettier:fix

# Check formatting
fmt-check:
	@echo "Checking formatting..."
	@npm run prettier:check

# Full CI pipeline (clean slate)
ci: clean lint typecheck test build
	@echo "CI pipeline passed!"

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@npm run clean

# Pre-commit hook management
pre-commit-install:
	@echo "Installing pre-commit hooks..."
	@pre-commit install
	@pre-commit install --hook-type commit-msg
	@pre-commit install --hook-type pre-push

pre-commit:
	@echo "Running pre-commit checks..."
	@pre-commit run --all-files

pre-commit-run: pre-commit

# Display help
help:
	@echo "ui - React Application"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Development:"
	@echo "  all                  Lint and test (default)"
	@echo "  dev                  Start development server (port 3000)"
	@echo "  build                Production build"
	@echo "  ci                   Full CI: clean + lint + typecheck + test + build"
	@echo ""
	@echo "Testing:"
	@echo "  test                 Run test suite"
	@echo "  test-watch           Run tests in watch mode"
	@echo "  typecheck            TypeScript type checking"
	@echo ""
	@echo "Code Quality:"
	@echo "  lint                 Run ESLint"
	@echo "  lint-fix             Fix ESLint issues"
	@echo "  fmt                  Format with Prettier"
	@echo "  fmt-check            Check formatting"
	@echo "  pre-commit           Run pre-commit hooks"
	@echo "  pre-commit-install   Install pre-commit hooks"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean                Remove build artifacts"
	@echo "  help                 Show this help message"
