# syntax=docker/dockerfile:1.7
#
# Multi-stage build for geode-ui.
#
# IMPORTANT — build context:
#   The geode-ui go.mod includes a `replace geodedb.com/geode => ../geode-client-go`
#   directive (relative path resolved at module-resolution time). Until the geode
#   driver is published to a public Go module proxy, the Docker build context
#   MUST contain a sibling `geode-client-go/` directory next to `geode-ui/`.
#
#   Recommended invocation (from the parent directory containing both repos):
#     docker build \
#       -f geode-ui/deploy/Dockerfile \
#       -t geode-ui:dev \
#       .
#
#   The Dockerfile assumes:
#     - geode-ui/        is the project this Dockerfile lives in
#     - geode-client-go/ is the local geode driver source the replace points at
#
#   If `geodedb.com/geode` becomes available via a real Go proxy, drop both the
#   replace directive in go.mod and the COPY of geode-client-go/ below.

# ----- Stage 1: build the SPA -----
FROM node:22-alpine AS web
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
FROM golang:1.26-alpine AS gobuild
ENV GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.2
RUN apk add --no-cache git
WORKDIR /work
# Sibling driver source needed because of the local replace directive.
# Layout inside the build image:
#   /work/geode-ui/        ← module root
#   /work/geode-client-go/ ← replace target
COPY geode-client-go/ /work/geode-client-go/
COPY --from=web /work/ /work/geode-ui/
WORKDIR /work/geode-ui
# The committed go.mod uses a developer-local absolute replace path. Rewrite
# it to the in-container sibling location so this build is self-contained.
RUN go mod edit -replace=geodedb.com/geode=/work/geode-client-go
RUN go mod download
# Static binary, stripped, reproducible paths.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/geode-ui ./cmd/server

# ----- Stage 3: minimal runtime -----
FROM alpine:3.20
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
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/geode-ui"]
CMD ["-listen", ":8080"]
