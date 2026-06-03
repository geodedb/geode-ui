#!/usr/bin/env bash
# Pre-commit / CI guard: the release pipeline MUST reliably publish a
# deployable container image to the GitLab Container Registry on every
# `v*` tag, WITHOUT depending on Docker-in-Docker (dind).
#
# Why this guard exists (the bug it locks out):
#   geode-ui releases historically tried to build + push the container
#   image through GoReleaser's `dockers:` (buildx) path, which requires a
#   Docker daemon (docker:25-dind). The company k8s runner's dind sidecar
#   was unreliable across v0.1.9–v0.1.28 — when it failed, the release job
#   silently fell back to `--skip=docker` and shipped .deb/.rpm/binary
#   artifacts but NO container image. ArgoCD Image Updater on the arda
#   cluster watches `registry.gitlab.com/devnw/codepros/geode/geode-ui`
#   for `^[0-9]+\.[0-9]+\.[0-9]+$` tags, so a release with no image is not
#   auto-deployable (v0.1.28 had to be built + pushed by hand).
#
# The fix: a daemonless kaniko `docker:release` job owns image publishing
# (no dind), and GoReleaser is invoked with `--skip=docker` so it only
# produces the binary / nfpm artifacts. This guard fails loudly if a
# future edit reintroduces the dind coupling or removes the kaniko job.
#
# Usage: check-release-image.sh [path-to-.gitlab-ci.yml]
#   Defaults to .gitlab-ci.yml (so existing pre-commit invocations work).
set -euo pipefail

CI_FILE="${1:-.gitlab-ci.yml}"

if [ ! -f "$CI_FILE" ]; then
  echo "check-release-image: FATAL: $CI_FILE not found" >&2
  exit 2
fi

FAIL=0
fail() {
  echo "check-release-image: FAIL: $*" >&2
  FAIL=$((FAIL + 1))
}

# Extract a single top-level GitLab CI job block by name. A job begins at
# `^<name>:` (column 0) and ends at the next column-0 line (the next
# top-level key or comment), exclusive. Blank and indented lines stay in
# the block.
job_block() {
  local job="$1"
  awk -v hdr="^${job}:" '
    $0 ~ hdr { inblock = 1; print; next }
    inblock && /^[^[:space:]]/ { inblock = 0 }
    inblock { print }
  ' "$CI_FILE"
}

# ---------------------------------------------------------------------------
# 1. A dedicated docker:release job must exist.
# ---------------------------------------------------------------------------
if ! grep -qE '^docker:release:' "$CI_FILE"; then
  fail "no 'docker:release' job found — the reliable release-image producer is missing"
fi

REL_BLOCK="$(job_block 'docker:release' || true)"

if [ -n "$REL_BLOCK" ]; then
  # 2. It must build with kaniko (daemonless), not a docker:dind service.
  if ! printf '%s\n' "$REL_BLOCK" | grep -q 'kaniko-project/executor'; then
    fail "docker:release does not use the kaniko executor image (daemonless builder required)"
  fi
  if printf '%s\n' "$REL_BLOCK" | grep -qE 'docker:[0-9.]*-?dind|docker-in-docker'; then
    fail "docker:release pulls in a docker:dind service — the release image must build WITHOUT dind"
  fi

  # 3. It must publish the ArgoCD-watched GitLab Container Registry image.
  if ! printf '%s\n' "$REL_BLOCK" | grep -q -- '--destination'; then
    fail "docker:release has no '--destination' — it does not push any image"
  fi
  if ! printf '%s\n' "$REL_BLOCK" | grep -q 'CI_REGISTRY_IMAGE'; then
    fail "docker:release does not push \$CI_REGISTRY_IMAGE (the image ArgoCD Image Updater watches)"
  fi

  # 4. It must run on release tags (not just main).
  if ! printf '%s\n' "$REL_BLOCK" | grep -qE 'CI_COMMIT_TAG\s*=~'; then
    fail "docker:release is not gated on a \$CI_COMMIT_TAG tag rule — it would not run on releases"
  fi
fi

# ---------------------------------------------------------------------------
# 5. GoReleaser must NOT be the (dind-dependent) image producer on release:
#    the goreleaser-release job has to delegate images to kaniko via
#    --skip=docker, and the shared .goreleaser-base must not pull in a
#    docker:dind service. (docker:build and e2e:playwright legitimately keep
#    their own dind — they are NOT the release-image path, so we only assert
#    the GoReleaser release path here.)
# ---------------------------------------------------------------------------
if grep -qE '^goreleaser-release:' "$CI_FILE"; then
  GR_BLOCK="$(job_block 'goreleaser-release' || true)"
  if ! printf '%s\n' "$GR_BLOCK" | grep -q -- '--skip=docker'; then
    fail "goreleaser-release does not pass '--skip=docker' — it would try to build images via the unreliable dind path"
  fi
fi

if grep -qE '^\.goreleaser-base:' "$CI_FILE"; then
  BASE_BLOCK="$(job_block '\.goreleaser-base' || true)"
  if printf '%s\n' "$BASE_BLOCK" | grep -qE 'docker:[0-9.]*-?dind|docker-in-docker'; then
    fail ".goreleaser-base still declares a docker:dind service — the release path must not depend on dind (kaniko owns images now)"
  fi
fi

if [ "$FAIL" -gt 0 ]; then
  echo >&2
  echo "check-release-image: ${FAIL} problem(s). The release pipeline must publish a" >&2
  echo "deployable container image via kaniko (no dind). See the header of this script." >&2
  exit 1
fi

echo "check-release-image: OK — daemonless kaniko docker:release publishes \$CI_REGISTRY_IMAGE on tags; goreleaser uses --skip=docker."
exit 0
