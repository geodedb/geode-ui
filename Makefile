SHELL := /usr/bin/env bash
GOEXPERIMENT ?= jsonv2
GOTOOLCHAIN ?= go1.26.3
GOENV := GOEXPERIMENT=$(GOEXPERIMENT) GOTOOLCHAIN=$(GOTOOLCHAIN)
BIN := bin/geode-ui

# QUALITY #174: Go package discovery enumeration.
#
# `./...` from the repo root walks `node_modules/flatted/golang/pkg/flatted`
# (an unrelated Go file shipped inside an npm dependency) and tries to
# include it in package discovery. Enumerating the project's own Go
# trees explicitly keeps `go list`, `go test`, `go vet`, and friends
# scoped to the source we actually own.
#
# Update this list when a new top-level Go directory is added.
GO_PKGS := ./cmd/... ./gen/... ./internal/...

.PHONY: all help generate go-build go-test go-cover go-lint go-fmt go-tidy bench-gate bench-baseline bench-record bench-graph web-install web-build web-dev web-test web-lint web-fmt web-typecheck build test lint fmt ci clean dev pre-commit e2e-deps e2e-up e2e-down e2e-logs e2e-test e2e-ci

all: lint test build

help:
	@cat scripts/help.txt

# ----- Code generation -----
#
# QUALITY #177: stale-detect sentinel. `make build` previously ran
# `genapi generate` + `go mod tidy` on every invocation even when
# geode.json hadn't changed since the last regen — adding ~10s of
# no-op work to every warm rebuild. `scripts/generate-if-stale.sh`
# hashes geode.json and short-circuits when the SHA matches the
# value recorded in gen/.sentinel. Force a re-run with
# `make generate-force` or by setting `FORCE_REGEN=1`.
generate:
	@$(GOENV) scripts/generate-if-stale.sh

generate-force:
	@FORCE_REGEN=1 $(GOENV) scripts/generate-if-stale.sh

.PHONY: generate-force

# ----- Go build/test -----
go-build: web-build
	$(GOENV) go build -o $(BIN) ./cmd/server

go-test:
	$(GOENV) go test -race -cover -failfast $(GO_PKGS)

# QUALITY #48: Go coverage ratchet. Runs go test with -coverprofile,
# extracts the total ratio via `go tool cover -func`, and compares
# against the committed floor (79% today; bump in a follow-up after
# a deliberate coverage push).
go-cover:
	scripts/check-go-coverage.sh

go-lint:
	@command -v golangci-lint > /dev/null 2>&1 || ( \
	  echo "==> golangci-lint not found; bootstrap via scripts/install-tools.sh" && \
	  scripts/install-tools.sh )
	$(GOENV) golangci-lint run $(GO_PKGS)

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
#
# GAP-035 (#276): BENCH_OUT controls the output path so a repeat run
# does not silently overwrite a historical baseline. Defaults to
# docs/performance/$(date +%Y-%m-%d)-perf-smoke.results.json so each
# day's bench lands at a distinct path. Override at invocation time
# (e.g. `make bench-graph BENCH_OUT=/tmp/foo.results.json`).
BENCH_OUT ?= docs/performance/$(shell date +%Y-%m-%d)-perf-smoke.results.json

bench-graph:
	BENCH_OUT=$(BENCH_OUT) GIT_COMMIT_SHA=$$(git rev-parse --short=7 HEAD) \
	  npx playwright test \
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
	@echo "    $(BENCH_OUT)"
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

# Image tags must match docker-compose.test.yml's `image:` fields
# exactly — compose finds these by name when run with `up -d` (no
# --build), so any drift here causes a transparent pull attempt
# instead of using the locally-built image.
GEODE_IMAGE    := geode:v0.5.19
GEODE_UI_IMAGE := geode-ui:e2e

# Per-checkout test env. Generated on first `make e2e-up` (see e2e-env
# below) and consumed via `docker compose --env-file`. Gitignored —
# never committed; CI provides its own.
E2E_ENV_FILE := deploy/.env.test

# Generate per-checkout test secrets if deploy/.env.test is missing.
# SEC #322/#323: the compose file no longer carries inline defaults for
# GEODE_PROFILESTORE_KEY or JWT_SECRET_HEX, so unset envs cause `up` to
# fail loud. This target produces fresh random values on first invocation
# and is idempotent thereafter — re-running it never overwrites an
# existing env file. CI bypasses this by supplying its own env vars or
# its own .env.test before `make e2e-up`.
e2e-env:
	@if [ -f $(E2E_ENV_FILE) ]; then \
	  echo "==> $(E2E_ENV_FILE) already present (skipping generation)"; \
	else \
	  echo "==> generating $(E2E_ENV_FILE) with fresh random secrets"; \
	  umask 077 && { \
	    echo "# Generated by 'make e2e-env'. Test stack only — never copy to production."; \
	    echo "# Regenerate with: rm $(E2E_ENV_FILE) && make e2e-env"; \
	    echo "GEODE_PROFILESTORE_KEY=$$(openssl rand -base64 32)"; \
	    echo "JWT_SECRET_HEX=$$(openssl rand -hex 32)"; \
	  } > $(E2E_ENV_FILE); \
	fi

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

# Build the e2e images with `docker build` directly rather than letting
# `docker compose up --build` drive them. Two reasons:
#
# 1. Docker Compose v5+ routes builds through `docker buildx bake`,
#    which has shown context-transfer flakiness on relative `context:`
#    paths that escape the compose-file directory (`context: ../..`
#    here). Delegating builds out of compose makes the build path the
#    same regardless of compose version.
#
# 2. `cd -P ..` (physical, not logical) is required because geode-ui
#    is occasionally checked out via a parent directory whose siblings
#    are symlinks pointing to the canonical worktree elsewhere. Plain
#    `cd ..` lands in the symlink-laden parent — BuildKit refuses to
#    follow symlinks that escape the build context root, so it loads
#    a near-empty (~91 B) context and the `COPY geode/zig-out/bin/
#    geode` step fails with "not found". `cd -P ..` resolves through
#    the symlinks to the canonical parent that actually contains the
#    binary, the geode-client-go sources, etc.
e2e-build: e2e-deps
	@echo "==> building $(GEODE_IMAGE)"
	cd -P .. && docker build -f geode-ui/deploy/geode/Dockerfile.geode -t $(GEODE_IMAGE) .
	@echo "==> building $(GEODE_UI_IMAGE)"
	cd -P .. && docker build -f geode-ui/deploy/Dockerfile -t $(GEODE_UI_IMAGE) .

# Bring up the test stack (images already built by e2e-build; compose
# only starts containers + runs the seed init). Sources the per-checkout
# .env.test (auto-generated by e2e-env) via `--env-file` so the compose
# file's required-from-env secrets resolve without falling back to
# hardcoded test values.
e2e-up: e2e-env e2e-build
	$(COMPOSE) --env-file $(E2E_ENV_FILE) up -d
	@echo "stack is up — http://localhost:8080 (UI), :8090 (MCP), :2087 (LSP), :3141/udp (Geode)"

# Tear down + delete named volumes (full reset for next run). Depends
# on e2e-env because compose validates the full file's `${VAR:?msg}`
# references on every command (not just `up`); without the env file
# present, even `down` errors out. The `e2e-env` rule is idempotent —
# re-running it never overwrites an existing file — so depending on it
# from `down` is safe and avoids a "you must e2e-up first" footgun.
e2e-down: e2e-env
	$(COMPOSE) --env-file $(E2E_ENV_FILE) down -v

# Tail logs from every service (Ctrl-C to detach).
e2e-logs: e2e-env
	$(COMPOSE) --env-file $(E2E_ENV_FILE) logs -f

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
