# Releasing geode-ui

This repo ships three artifact families on every tag:

| Artifact | Where | Built by |
|---|---|---|
| Container images | GitLab Container Registry + `docker.io/geodedb/geode-ui` | GoReleaser (`.goreleaser.yaml`) |
| Linux packages (.deb / .rpm / .apk) | GitLab Release page assets | GoReleaser nFPM |
| Electron desktop installers (.dmg / .AppImage / .deb / .exe) | GitLab Release page assets | electron-builder |

The pipeline mirrors `../geode/.gitlab-ci.yml` — same `goreleaser:snapshot` /
`goreleaser:release` two-track model, same `SKIP_DOCKERHUB` gate, same
manifest tag conventions (`latest`, `vMAJOR`, `vMAJOR.MINOR`,
`<version>-alpine`, etc.).

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
| `WIN_CSC_LINK` | Authenticode cert (base64 .pfx) | Signed Windows .exe |
| `WIN_CSC_KEY_PASSWORD` | Password for `WIN_CSC_LINK` | same |

The pipeline still runs without the optional code-signing variables; the
mac/win installers are produced unsigned and operators see the OS warning
on first launch.

## Cutting a release

1. Make sure `main` is green (lint + unit + go:test + e2e all passing).
2. Bump the version per Conventional Commits + `pnpm` workspace if needed.
3. Tag the commit with a SemVer-compatible name and push:

   ```bash
   git tag -a v0.2.0 -m "release v0.2.0"
   git push origin v0.2.0
   ```

4. The pipeline triggered by the tag runs:
   - `goreleaser:release` — builds binaries, packages, container images
     for both registries.
   - `electron:linux` / `electron:mac` / `electron:win` — build platform
     installers (mac + win are `allow_failure: true` until those runners
     are registered).
   - `release:publish` — uploads every artifact to the GitLab Generic
     Package Registry under `geode-ui/<version>/`, then creates the
     GitLab Release page with all links attached.

The Release page lands at
`https://gitlab.com/devnw/codepros/geode/geode-ui/-/releases/<tag>`.

## What gets published, by tag

| Tag | GitLab Container Registry | Docker Hub |
|---|---|---|
| `<version>` (e.g. `0.2.0`) | ✓ | ✓ |
| `<version>-alpine` | ✓ | ✓ |
| `<version>-amd64` / `-arm64` (single-arch) | ✓ | ✓ |
| `<version>-alpine-amd64` / `-alpine-arm64` | ✓ | ✓ |
| `latest` (multi-arch) | ✓ | ✓ |
| `alpine` (multi-arch alpine) | ✓ | ✓ |
| `vMAJOR` (e.g. `v0`) | ✓ | ✓ |
| `vMAJOR.MINOR` (e.g. `v0.2`) | ✓ | ✓ |

## Snapshot builds (main branch)

Every push to `main` triggers `goreleaser:snapshot` (allow_failure):

- Builds the Go binary + 4 container images locally.
- Pushes container tags `<version>-snapshot-<sha>` to GitLab Container
  Registry only (Docker Hub is skipped on snapshots).
- Skips Electron installer builds (they're tag-only).

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
