SHELL := /usr/bin/env bash
GOEXPERIMENT ?= jsonv2
GOTOOLCHAIN ?= go1.27.2
GOENV := GOEXPERIMENT=$(GOEXPERIMENT) GOTOOLCHAIN=$(GOTOOLCHAIN)
BIN := bin/geode-ui

.PHONY: all help generate go-build go-test go-lint go-fmt go-tidy bench-gate bench-baseline bench-record bench-graph web-install web-build web-dev web-test web-lint web-fmt web-typecheck build test lint fmt ci clean dev pre-commit e2e-deps e2e-up e2e-down e2e-logs e2e-test e2e-ci

all: lint test build

help:
	@cat scripts/help.txt

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
	$(GOENV) python3 scripts/golangci-lint.py run

go-fmt:
	$(GOENV) gofmt -s -w .
	$(GOENV) goimports -w .

go-tidy:
	$(GOENV) go mod tidy

# ----- Performance regression gate -----
# bench-gate runs the curated benchmark set (see scripts/bench-gate.sh) and
# fails if any benchmark regresses by more than BENCH_GATE_THRESHOLD percent
# (default 10%) in ns/op, B/op, or allocs/op versus the committed
# bench-baseline.txt. It's informational-leaning — CI runners are noisy, so the
# CI job is `allow_failure: true`. Refresh the baseline after a deliberate perf
# change with `make bench-baseline` (alias: `make bench-record`).
bench-gate:
	$(GOENV) ./scripts/bench-gate.sh gate

bench-baseline:
	$(GOENV) ./scripts/bench-gate.sh record

bench-record: bench-baseline

# Graph-renderer A/B benchmark (cytoscape vs reagraph) — drives the
# dev-only /dev/graph-bench route. Requires the geode-ui container up
# on :8080 (or override UI_URL). The SHA is sourced from git rev-parse
# inside the recipe (Make's $$(...) defers evaluation to recipe time),
# so the Playwright spec itself stays shell-out free.
bench-graph:
	GIT_COMMIT_SHA=$$(git rev-parse --short=7 HEAD) npx playwright test \
	  --config=e2e/playwright.config.ts \
	  e2e/specs/19-graph-bench.spec.ts \
	  --workers=1 --project=chromium

# Perf-pipeline smoke: drives the bench harness end-to-end. The bench
# emits graph:rebuild / graph:layout / graph:firstInteractive marks that
# the harness extracts into the results JSON. Run after a container
# rebuild (`make e2e-up`) so the running build contains the perfMarks
# wiring and tier writeback. Not part of CI; manual / scheduled only.
perf-smoke: bench-graph
	@echo "==> perf-smoke: bench output landed at"
	@echo "    docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json"
	@echo "    Check the layoutMs / firstInteractiveMs / tier fields on each record."
	@echo "perf-smoke OK"

.PHONY: perf-smoke

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
	rm -rf gen internal/ui/dist bin coverage.txt *.out

dev:
	@echo "Run 'make web-dev' in one terminal and './$(BIN) -listen :8080' in another"

# ----- E2E stack -----
COMPOSE := docker compose -f deploy/docker-compose.test.yml

# Prerequisite: build the geode binary on the host because the
# Dockerfile.geode runtime stage COPYs ../geode/zig-out/bin/geode.
# Zig caches builds, so this is idempotent and fast on rebuilds.
e2e-deps:
	@if [ ! -f ../geode/zig-out/bin/geode ]; then \
	  echo "==> building geode binary at ../geode (one-time, takes ~5 min cold)"; \
	  cd ../geode && zig build -Doptimize=ReleaseSafe; \
	else \
	  echo "==> ../geode/zig-out/bin/geode already present (skipping zig build)"; \
	fi

# Bring up the test stack (build images, run init, leave services running).
e2e-up: e2e-deps
	$(COMPOSE) up -d --build
	@echo "stack is up — http://localhost:8080 (UI), :8090 (MCP), :2087 (LSP), :3141/udp (Geode)"

# Tear down + delete named volumes (full reset for next run).
e2e-down:
	$(COMPOSE) down -v

# Tail logs from every service (Ctrl-C to detach).
e2e-logs:
	$(COMPOSE) logs -f

# Run Playwright against an already-running stack (assumes e2e-up was called).
# Playwright lands in E8+; this guards if e2e/ isn't populated yet.
e2e-test:
	@[ -d e2e ] || (echo "==> e2e/ directory not yet present — Playwright not installed (Phase 2 of the plan)"; exit 1)
	cd e2e && npx playwright test

# Full CI run: bring up, wait for health, run tests, tear down.
e2e-ci: e2e-up
	@echo "==> waiting for geode-ui health..."
	@for i in $$(seq 1 30); do \
	  if wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; then break; fi; \
	  sleep 2; \
	done
	$(MAKE) e2e-test
	$(MAKE) e2e-down

pre-commit: fmt go-tidy lint test
