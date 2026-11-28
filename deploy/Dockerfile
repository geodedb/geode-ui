# syntax=docker/dockerfile:1.29
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
# Ordinary CI image builds use this Dockerfile too. Test hooks require an
# explicit build argument from the test Compose stack; production defaults
# let webpack eliminate the gated Playwright bootstrap block.
ARG GEODE_E2E_BUILD=false
ENV GEODE_E2E_BUILD=${GEODE_E2E_BUILD}
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
FROM alpine:3.24 AS runtime
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

# The DinD daemon cannot bind-mount files from the CI job's checkout. Ship
# the fixture through the build context, only in the Compose test target.
FROM runtime AS e2e
COPY --chown=geode:geode geode-ui/deploy/profiles.json /etc/geode-ui/profiles.json

# Keep ordinary builds free of the E2E connection profile.
FROM runtime AS final
