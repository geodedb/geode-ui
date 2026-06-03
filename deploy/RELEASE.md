# Releasing geode-ui

This repo ships three artifact families on every tag:

| Artifact | Where | Built by |
|---|---|---|
| Container image | GitLab Container Registry (always) + `docker.io/geodedb/geode-ui` (when Docker Hub creds set) | **kaniko** — `docker:release` job (daemonless, no dind) |
| Linux packages (.deb / .rpm / .apk) | GitLab Release page assets | GoReleaser nFPM |
| Electron desktop installers (.dmg / .AppImage / .deb / .exe) | GitLab Release page assets | electron-builder |

The binary + package pipeline mirrors `../geode/.gitlab-ci.yml`'s
`goreleaser-snapshot` / `goreleaser-release` two-track model. GoReleaser runs
with `--skip=docker` in CI; the deployable **container image** is built and
pushed separately by the daemonless **kaniko** `docker:release` job. This
avoids Docker-in-Docker, which was unreliable on the company k8s runner and
left several releases (v0.1.9–v0.1.28) shipping with no auto-deployable image
(v0.1.28 had to be built and pushed by hand). The kaniko job consumes the
exact production binary GoReleaser builds (`dist/`) and feeds it to the
hardened `deploy/Dockerfile.release`.

## Required CI variables

Set these as **protected** CI variables in GitLab project settings → CI/CD
→ Variables. Mark them `Protect variable: yes` so they only appear on
protected refs (release tags + main).

| Variable | Purpose | Required for |
|---|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub login (`geodedb`) | Pushing to `docker.io/geodedb/geode-ui` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (NOT the password) | same |
| `CSC_LINK` | Apple Developer ID `.p12` cert (base64-encoded) | Signed macOS .dmg |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK` | same |
| `ESIGNER_USERNAME` | ssl.com eSigner account email | Signed Windows .exe (EV) |
| `ESIGNER_PASSWORD` | ssl.com eSigner account password | same |
| `ESIGNER_CREDENTIAL_ID` | ssl.com EV cert credential ID | same |
| `ESIGNER_TOTP_SECRET` | base32 TOTP shared secret | same |

The pipeline still runs without the optional code-signing variables; the
mac/win installers are produced unsigned and operators see the OS warning
on first launch.

`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` are already set at the
`devnw/codepros/geode` group level — no per-project action needed.

### Windows EV signing (ssl.com)

Windows installers go through the
[`codesign-windows-ssl`](https://gitlab.com/devnw/ci-catalog/-/tree/main/templates/codesign-windows-ssl)
ci-catalog component, which signs `release/win/*.exe` in place using
ssl.com's eSigner cloud HSM. Setup steps live in that component's
`README.md` — short version:

1. Buy an EV Code Signing certificate from ssl.com and complete the
   organization-validation paperwork (~3-5 business days).
2. Activate eSigner during cert provisioning. ssl.com walks you through
   account creation (`ESIGNER_USERNAME` + `ESIGNER_PASSWORD`), credential
   linking (`ESIGNER_CREDENTIAL_ID`), and TOTP setup
   (`ESIGNER_TOTP_SECRET` is the base32 string from the QR code, NOT a
   one-time code — ssl.com only shows it once).
3. Provision the four `ESIGNER_*` variables above. Recommend setting
   them at the `devnw/codepros/geode` GROUP level so all geode-family
   repos can sign without duplicating values. Mark all four `Masked`
   and `Protected`.
4. Cut a tag — `codesign:electron-win` runs after `electron:win`,
   re-uploads `release/win/*.exe` with the signature applied, and
   `release:publish` picks up the signed binaries automatically.

For Apple-side macOS notarization, the existing `CSC_LINK` variables
feed electron-builder directly (no separate ci-catalog component yet).

## Breaking changes (operator migration notes)

Operators upgrading across these versions MUST take the listed action or
the new build will silently change behaviour:

| Version | Change | Required operator action |
|---|---|---|
| _unreleased_ (SEC-NEW-2 / #202) | `-admin-users` flag now defaults to `""` (no auto-bootstrap) | Add `-admin-users=geode` (or your existing comma-separated list) to startup args. Without this, no user is granted the `admin` role on login. The startup log emits a single `audit_event=admin_bootstrap` record with `admin_count` and the sorted `admin_users` list — verify it matches your expectation. |

## Cutting a release

1. Make sure `main` is green (lint + unit + go:test + e2e all passing).
2. Bump the version per Conventional Commits + `npm` workspace if needed.
3. Tag the commit with a SemVer-compatible name and push:

   ```bash
   git tag -a v0.2.0 -m "release v0.2.0"
   git push origin v0.2.0
   ```

4. The pipeline triggered by the tag runs:
   - `goreleaser-release` — builds the Go binary + Linux packages
     (.deb/.rpm/.apk) and exposes its `dist/` binary as an artifact.
   - `docker:release` — kaniko (no dind) builds `deploy/Dockerfile.release`
     from that binary and pushes the container image to the GitLab Container
     Registry (and Docker Hub when `DOCKERHUB_*` are set).
   - `electron:linux` / `electron:mac` / `electron:win` — build platform
     installers (mac + win are `allow_failure: true` until those runners
     are registered).
   - `release:publish` — uploads every artifact to the GitLab Generic
     Package Registry under `geode-ui/<version>/`, then creates the
     GitLab Release page with all links attached.

The Release page lands at
`https://gitlab.com/devnw/codepros/geode/geode-ui/-/releases/<tag>`.

## What gets published, by tag

The kaniko `docker:release` job pushes a `linux/amd64` image on every release:

| Tag | GitLab Container Registry | Docker Hub |
|---|---|---|
| `<version>` (e.g. `0.2.0`) — the tag ArgoCD Image Updater watches | ✓ (always) | ✓ (when `DOCKERHUB_*` set) |
| `latest` | ✓ (always) | ✓ (when `DOCKERHUB_*` set) |

> The multi-arch (arm64) and alpine variants in `.goreleaser.yaml`'s
> `dockers:` / `docker_manifests:` blocks are **not** published by CI — they
> require buildx and only ever succeeded when dind happened to be healthy.
> They remain available for local `goreleaser release --snapshot` builds.
> Restoring multi-arch in CI is a follow-up (kaniko per-arch jobs + a
> manifest-merge step, or a buildx revival once a reliable arm64 runner
> exists). The arda cluster runs amd64, so the single-arch image is
> deployable today.

## Snapshot builds (main branch)

Every push to `main` triggers `goreleaser-snapshot` (allow_failure):

- Builds the Go binary + Linux packages locally (`--skip=docker`; no images).
- Skips Electron installer builds (they're tag-only).

The main-branch container image used by the e2e stack is built separately by
the `docker:build` job, which pushes `$CI_REGISTRY_IMAGE:<commit-sha>`.

Snapshot artifacts expire after 3 days.

## Local testing

You can run goreleaser locally to confirm a config change:

```bash
# Install pinned goreleaser version
GORELEASER_VERSION=v2.13.3
curl -fsSL "https://github.com/goreleaser/goreleaser/releases/download/${GORELEASER_VERSION}/goreleaser_Linux_x86_64.tar.gz" \
  | sudo tar -xz -C /usr/local/bin goreleaser

# Verify config
goreleaser check

# Snapshot dry-run (no docker push, no publish)
goreleaser release --snapshot --clean --skip=docker,publish,sign
```

For an Electron-only test:

```bash
npm ci
npm run electron:build
npx electron-builder --linux --x64 --config electron-builder.yml
ls release/linux/
```

## Updating the goreleaser version

Bump `GORELEASER_VERSION` in `.gitlab-ci.yml` `variables:` block. Run a
snapshot build on a feature branch first to confirm the new version
parses the existing `.goreleaser.yaml`.

## Adding a new image variant

1. Add a new `dockers:` entry in `.goreleaser.yaml` pointing at a fresh
   `deploy/Dockerfile.release.<variant>`.
2. Add matching `docker_manifests:` entries for `<version>-<variant>`,
   `<variant>` (multi-arch), `vMAJOR-<variant>`, `vMAJOR.MINOR-<variant>`.
3. Bump `GORELEASER_VERSION` if the variant uses features added in a
   newer release.

## Adding a new electron OS

Add a parallel `electron:<os>` job in `.gitlab-ci.yml` extending
`.electron-base`, then list the new artifact glob in `release:publish`'s
`script:` upload loop.
