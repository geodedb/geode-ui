# syntax=docker/dockerfile:1.28
#
# Multi-stage build for geode-ui.
#
# Build context:
#   The geode driver (geodedb.com/geode) is consumed from the public Go
#   module proxy, so no sibling driver checkout is needed. The build context
#   is still the PARENT directory of geode-ui/ (paths below are prefixed
#   with geode-ui/) so existing compose files and CI keep working.
#
#   Recommended invocation (from the parent directory of geode-ui/):
#     docker build \
#       -f geode-ui/deploy/Dockerfile \
#       -t geode-ui:dev \
#       .

# ----- Stage 1: build the SPA -----
FROM node:26-alpine AS web
WORKDIR /work
COPY geode-ui/package.json geode-ui/package-lock.json ./
RUN npm ci
COPY geode-ui/ ./
# Webpack outputs to internal/ui/dist/ (per webpack.common.js); the Go
# embed.go uses //go:embed all:dist relative to internal/ui/.
#
# SECURITY (GAP-S2 / #115): this is the *e2e* Dockerfile, used by
# `make e2e-up` / docker-compose.test.yml. We set GEODE_E2E_BUILD=true
# so webpack's DefinePlugin substitutes `__E2E_ENABLED__` as the literal
# `true`, leaving the Playwright `addInitScript` backdoor reachable.
# The release Dockerfiles (Dockerfile.release, Dockerfile.release.alpine)
# deliberately do NOT set the env var, so production bundles dead-code-
# eliminate the gated block.
ENV GEODE_E2E_BUILD=true
RUN npm run build

# ----- Stage 2: build the Go binary -----
FROM golang:1.27.2-alpine AS gobuild
ENV GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.27.2
RUN apk add --no-cache git
WORKDIR /work
COPY --from=web /work/ /work/geode-ui/
WORKDIR /work/geode-ui
RUN go mod download
# Static binary, stripped, reproducible paths.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/geode-ui ./cmd/server

# ----- Stage 3: minimal runtime -----
FROM alpine:3.24
RUN apk add --no-cache ca-certificates && \
    addgroup -S geode && adduser -S -G geode geode
COPY --from=gobuild /out/geode-ui /usr/local/bin/geode-ui
# Pre-create /var/lib/geode-ui/uploads owned by the runtime user so that
# named-volume mounts at this path inherit the ownership (Docker copies
# directory ownership from the image when the volume is empty on first
# mount). Without this, the mounted volume is root:root and the
# `geode` user can't write its multipart uploads.
RUN mkdir -p /var/lib/geode-ui/uploads/backups /var/lib/geode-ui/uploads/migrations && \
    chown -R geode:geode /var/lib/geode-ui
USER geode
# GAP-S5 (#118): the runtime requires GEODE_PROFILESTORE_KEY (base64 of
# 32 random bytes) to bring up the at-rest encryption layer for the
# SQLite profile store. We deliberately do NOT bake a key into the
# image — that would defeat the encryption-at-rest argument the moment
# the image leaks. Operators MUST supply the env var at `docker run`
# time (or via compose `environment:` / k8s Secret), e.g.:
#
#   docker run -e GEODE_PROFILESTORE_KEY="$(openssl rand -base64 32)" \
#              -p 8080:8080 geode-ui:dev ...
#
# The deploy/docker-compose.test.yml file pins a known test key so
# Playwright runs reproducibly; deploy/docker-compose.example.yml
# documents the production-recommended `openssl rand -base64 32` flow.
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/geode-ui"]
CMD ["-listen", ":8080"]
