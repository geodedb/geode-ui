SHELL := /usr/bin/env bash
GOEXPERIMENT ?= jsonv2
GOTOOLCHAIN ?= go1.26.2
GOENV := GOEXPERIMENT=$(GOEXPERIMENT) GOTOOLCHAIN=$(GOTOOLCHAIN)
BIN := bin/geode-ui

.PHONY: all help \
        generate go-build go-test go-lint go-fmt go-tidy \
        web-install web-build web-dev web-test web-lint web-fmt web-typecheck \
        build test lint fmt ci clean dev pre-commit

all: lint test build

help:
	@echo "Targets:"
	@echo "  make generate     Run genapi → gen/"
	@echo "  make build        Build SPA into dist/ then Go binary into $(BIN)"
	@echo "  make test         Run Go + JS tests"
	@echo "  make lint         Run Go + JS linters"
	@echo "  make dev          Run go server (terminal 1) and webpack dev (terminal 2)"
	@echo "  make ci           Full CI sequence"
	@echo "  make clean        Remove gen/, dist/, bin/, coverage"

# ----- Code generation -----
generate:
	$(GOENV) genapi generate --config geode.json --out gen/ --with-tests
	$(GOENV) go mod tidy

# ----- Go build/test -----
go-build: web-build
	$(GOENV) go build -o $(BIN) ./cmd/server

go-test:
	$(GOENV) go test -race -cover -failfast ./...

go-lint:
	$(GOENV) golangci-lint run

go-fmt:
	$(GOENV) gofmt -s -w .
	$(GOENV) goimports -w .

go-tidy:
	$(GOENV) go mod tidy

# ----- Web build/test (delegates to npm scripts) -----
web-install:
	npm ci

web-build:
	npm run build

web-dev:
	npm start

web-test:
	npm test -- --ci

web-lint:
	npm run lint

web-fmt:
	npm run prettier:fix

web-typecheck:
	npm run test:ts

# ----- Aggregates -----
build: generate go-build
test: web-test go-test
lint: web-lint go-lint
fmt: go-fmt web-fmt
ci: web-install lint web-typecheck test build
clean:
	rm -rf gen dist bin coverage.txt *.out

dev:
	@echo "Run 'make web-dev' in one terminal and './$(BIN) -listen :8080' in another"

pre-commit: fmt go-tidy lint test
