# `apt install geode-ui` + Local-Geode Auto-Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `geode-ui` installable on Debian/Ubuntu via `apt install geode-ui` exactly like the sibling `geode` package, with a parallel `geode-ui-desktop` electron .deb that does NOT clash, and auto-seed a `local-geode` profile pointing at `quic://localhost:3141` when the postinstall detects a co-resident `geode` install.

**Architecture:**
The headless service ships as a goreleaser nfpm package that drops `/usr/bin/geode-ui`, a systemd unit, an `/etc/geode-ui/geode-ui.conf` config, an `/etc/geode-ui/seed-profiles.d/` drop-in directory, and a `geode-ui` system user. The postinstall script detects a co-resident geode install (checks `/etc/geode/geode.conf` then `/usr/bin/geode`) and writes a `10-local-geode.json` drop-in into the seed dir; the server iterates `seed-profiles.d/*.json` on first launch (when its sqlite profile store is empty) and inserts each entry as a `scope=system` profile. The electron desktop app continues to expect a geode-ui server origin but its .deb is renamed to `geode-ui-desktop` to avoid colliding with the upstream `geode` package; its postinstall surfaces a hint pointing operators at `apt install geode-ui` for the matching server. CI publishes the new `.deb` to the existing apt repo alongside `geode`'s.

**Tech Stack:** GoReleaser v2 + nfpm v2 (deb/rpm/apk), systemd unit files, shell postinstall scripts, electron-builder, Go (`os.Stat` + JSON drop-in glob), TDD via `go test ./cmd/server/...` and shell-script bats-style smoke tests in a debian:bookworm container.

**Out of scope (do NOT include in this plan):**
- RPM / APK distribution polish beyond what nfpm gives for free (deb is the canonical target).
- Switching the seed format away from JSON.
- Migrating any existing `/etc/geode-ui/profiles.json`-based deployments (the JSON drop-in is purely additive — the existing `-profiles=<file>` flag stays).
- Replacing the electron-builder pipeline; only the artifact name / metadata change here.
- TLS hardening of the geode-ui→geode QUIC connection beyond what already exists (the seeded profile uses `insecure_tls_skip_verify=true` for a co-resident install; the operator changes that via `/api/v1/profiles` once they have a CA in place).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `deployment/systemd/geode-ui.service` | systemd unit that runs `/usr/bin/geode-ui` as user `geode-ui`. |
| `deployment/config/geode-ui.conf` | EnvironmentFile-style key=value defaults sourced by the unit (listen address, profile-store path, upload dir, JWT secret hint). |
| `deployment/seed-profiles.d/.gitkeep` | Empty seed dir shipped by the package; the postinstall writes `10-local-geode.json` here when geode is detected. |
| `scripts/packaging/preinstall.sh` | Creates the `geode-ui` system user/group and stops any running service before an upgrade. |
| `scripts/packaging/postinstall.sh` | Sets ownership/perms on `/var/lib/geode-ui`, `/var/log/geode-ui`, `/etc/geode-ui`; detects co-resident geode and writes `10-local-geode.json`; enables + starts the systemd unit on fresh install. |
| `scripts/packaging/preremove.sh` | Stops the systemd unit before files are removed. |
| `scripts/packaging/postremove.sh` | On `purge`, removes `/var/lib/geode-ui` and `/var/log/geode-ui`; on `remove`, leaves data intact. |
| `scripts/packaging/detect-local-geode.sh` | Pure helper sourced by postinstall that prints `1` to stdout if a co-resident geode is detected, `0` otherwise. Extracted so it is testable in isolation. |
| `cmd/server/profileseed_dropin.go` | New Go file that scans `<seedDir>/*.json` in lexicographic order and feeds each into the existing `seedFromJSON` path. |
| `cmd/server/profileseed_dropin_test.go` | Table-driven tests for the drop-in scanner. |
| `tests/packaging/apt-install-smoke.sh` | Bats-style script that runs in a `debian:bookworm` container; installs the .deb, starts the service, asserts `/api/v1/healthz` returns 200. |
| `docs/INSTALL.md` | Operator-facing install instructions paralleling `../geode`. Includes the apt repo curl one-liner and the manual `dpkg -i` path. |

### Modified files

| Path | What changes |
|---|---|
| `.goreleaser.yaml` | nfpms section gains the systemd unit, config file, seed-dir, scriptlets; new `provides: geode-ui` claim; `recommends: geode` so apt suggests the server when desktop pulls in the service indirectly. |
| `cmd/server/app.go:79-80` | New `-profile-seed-dir` flag pointing at `/etc/geode-ui/seed-profiles.d` by default; new `-listen` default stays `:8080` but env-var override `GEODE_UI_LISTEN` is honored when the flag is unset (matches the systemd EnvironmentFile pattern). |
| `cmd/server/app.go:252` | The `seedFromJSON` call grows a sibling `seedFromDropInDir` call that runs after the existing `-profiles` JSON seed. |
| `electron-builder.yml` | `linux.target: deb` block renamed: `artifactName: geode-ui-desktop_${version}_${arch}.${ext}`, `executableName: geode-ui-desktop`, top-level `productName: Geode UI` (no change to electron `appId`). New `linux.deb.depends: []` (explicitly do NOT depend on `geode-ui` — the desktop app works against any reachable origin). |
| `.gitlab-ci.yml` | The `apt-repo` job (or equivalent — the geode sibling has `generate-apt-repo.sh`; mirror that pattern) is updated to include `geode-ui_*.deb` so a single apt-repo serves both packages. |
| `CHANGELOG.md` | Adds the breaking-change note: the electron .deb filename changed from `geode_${version}_${arch}.deb` to `geode-ui-desktop_${version}_${arch}.deb`. |
| `README.md` | Top-level install section adds the apt one-liner alongside the existing docker/electron paths. |
| `docs/RELEASE.md` | Append a section on the two-package layout and the postinstall geode-detection. |

---

## Phase 1 — Service Package (apt-installable headless service)

### Task 1: Add the systemd unit

**Files:**
- Create: `deployment/systemd/geode-ui.service`

- [ ] **Step 1: Author the unit**

Write `deployment/systemd/geode-ui.service`:

```ini
[Unit]
Description=Geode UI - web admin & query UI for the Geode graph database
Documentation=https://gitlab.com/devnw/codepros/geode/geode-ui
After=network.target
# Soft dependency: when geode is co-installed start it first so the
# seeded local profile has a target. Use Wants= (not Requires=) so
# remote-only geode-ui deployments still boot.
Wants=geode.service
After=geode.service

[Service]
Type=simple
User=geode-ui
Group=geode-ui
EnvironmentFile=-/etc/geode-ui/geode-ui.conf
ExecStart=/usr/bin/geode-ui \
  -listen=${GEODE_UI_LISTEN} \
  -profile-store=${GEODE_UI_PROFILE_STORE} \
  -profile-seed-dir=${GEODE_UI_PROFILE_SEED_DIR} \
  -upload-dir=${GEODE_UI_UPLOAD_DIR}
Restart=on-failure
RestartSec=5s

# Security hardening (mirrors ../geode/deployment/systemd/geode.service)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/geode-ui /var/log/geode-ui /etc/geode-ui
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

LimitNOFILE=65536
LimitNPROC=512

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Verify systemd-analyze accepts the unit**

Run: `systemd-analyze verify deployment/systemd/geode-ui.service`
Expected: exit 0, no diagnostics. (CI can skip this on non-Linux runners; the smoke-test container at Task 10 also covers it.)

- [ ] **Step 3: Commit**

```bash
git add deployment/systemd/geode-ui.service
git commit -m "feat(packaging): systemd unit for the geode-ui service"
```

---

### Task 2: Add the default EnvironmentFile config

**Files:**
- Create: `deployment/config/geode-ui.conf`

- [ ] **Step 1: Author the conf file**

Write `deployment/config/geode-ui.conf`:

```bash
# Geode UI default service configuration.
#
# Sourced by the systemd unit at /lib/systemd/system/geode-ui.service.
# Edit values and `systemctl restart geode-ui` to apply.
#
# Lines starting with # are comments. Values containing spaces must be
# quoted ("value with spaces").

# Address the HTTP server binds to. Loopback by default for local-only
# desktop installs; flip to "0.0.0.0:8080" to expose on the LAN. Set a
# reverse proxy in front if you do.
GEODE_UI_LISTEN=127.0.0.1:8080

# Path to the SQLite profile store. /var/lib/geode-ui is owned by the
# geode-ui system user and is excluded from /usr (ProtectSystem=strict).
GEODE_UI_PROFILE_STORE=/var/lib/geode-ui/profiles.db

# Directory scanned at first launch for *.json profile seeds. Drop-ins
# land here from the postinstall (e.g. 10-local-geode.json when geode
# is co-installed). Files are read in lexicographic order; later files
# do NOT overwrite earlier ones (first-wins on profile name).
GEODE_UI_PROFILE_SEED_DIR=/etc/geode-ui/seed-profiles.d

# Where multipart uploads (backup files, migration content) are
# persisted. Auto-created subdirs: backups/ and migrations/.
GEODE_UI_UPLOAD_DIR=/var/lib/geode-ui/uploads
```

- [ ] **Step 2: Commit**

```bash
git add deployment/config/geode-ui.conf
git commit -m "feat(packaging): default EnvironmentFile for geode-ui systemd unit"
```

---

### Task 3: Add the seed-profiles drop-in directory placeholder

**Files:**
- Create: `deployment/seed-profiles.d/.gitkeep`
- Create: `deployment/seed-profiles.d/README.md`

- [ ] **Step 1: Stub the directory**

```bash
mkdir -p deployment/seed-profiles.d
touch deployment/seed-profiles.d/.gitkeep
```

Write `deployment/seed-profiles.d/README.md`:

```markdown
# /etc/geode-ui/seed-profiles.d

Drop-in directory scanned by `geode-ui` on first launch (only when its
SQLite profile store at `/var/lib/geode-ui/profiles.db` is empty).
Files matching `*.json` are read in lexicographic order; each is
expected to be a `[]conn.Profile` JSON array (same shape as the legacy
`-profiles <file>` flag).

The postinstall script writes `10-local-geode.json` here when it
detects a co-resident `geode` install. Operators may add their own
`*.json` files for additional seeds, or delete the local-geode drop-in
to suppress it before the first launch.
```

- [ ] **Step 2: Commit**

```bash
git add deployment/seed-profiles.d/
git commit -m "feat(packaging): seed-profiles.d drop-in directory + README"
```

---

### Task 4: Add the `detect-local-geode.sh` pure helper

**Files:**
- Create: `scripts/packaging/detect-local-geode.sh`

- [ ] **Step 1: Author the helper**

Write `scripts/packaging/detect-local-geode.sh`:

```bash
#!/bin/sh
# detect-local-geode.sh — print "1" iff a co-resident geode install is
# detected on the host, "0" otherwise. Pure helper sourced by the
# postinstall so it is testable in isolation.
#
# Detection precedence (first hit wins):
#   1. /etc/geode/geode.conf exists (the geode .deb's default config)
#   2. /usr/bin/geode is an executable file (the geode .deb's binary)
#
# We deliberately do NOT probe the network — postinstall must work
# offline and on first boot before geode has had a chance to start.

set -e

if [ -f /etc/geode/geode.conf ]; then
    echo 1
    exit 0
fi

if [ -x /usr/bin/geode ]; then
    echo 1
    exit 0
fi

echo 0
```

- [ ] **Step 2: Make it executable and verify the two positive cases**

```bash
chmod +x scripts/packaging/detect-local-geode.sh
# Negative case (assuming geode is NOT installed in the dev env):
result=$(./scripts/packaging/detect-local-geode.sh)
test "$result" = "0" || { echo "expected 0, got $result"; exit 1; }
# Positive case 1: synthesise /etc/geode/geode.conf in a tmpdir and
# re-rooted check via env override (the helper only supports the
# absolute paths so we use sudo-touch in CI smoke instead).
```

If the dev box does not have geode installed, the negative case is enough; the positive case is exercised end-to-end in Task 10.

- [ ] **Step 3: Commit**

```bash
git add scripts/packaging/detect-local-geode.sh
git commit -m "feat(packaging): detect-local-geode.sh pure helper"
```

---

### Task 5: Add the preinstall script

**Files:**
- Create: `scripts/packaging/preinstall.sh`

- [ ] **Step 1: Author preinstall**

Write `scripts/packaging/preinstall.sh`:

```bash
#!/bin/sh
# Pre-installation script for geode-ui.
#
# Idempotent: safe to re-run on upgrade.
#   1. Create the geode-ui system user/group if missing.
#   2. Stop a running geode-ui.service before the new binary is laid
#      down so a half-upgraded process does not race the file replace.

set -e

# 1. User/group. The home dir is /var/lib/geode-ui (set later by
# postinstall once it exists with correct perms) and the shell is
# /usr/sbin/nologin so the account cannot be logged into.
if ! getent group geode-ui >/dev/null; then
    groupadd --system geode-ui
fi
if ! getent passwd geode-ui >/dev/null; then
    useradd --system \
        --gid geode-ui \
        --home-dir /var/lib/geode-ui \
        --shell /usr/sbin/nologin \
        --comment "Geode UI service user" \
        geode-ui
fi

# 2. Stop any currently-running service before the package manager
# replaces the binary. `systemctl` may not exist in container build
# environments (chroots, debootstrap) — fail open.
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet geode-ui.service; then
        systemctl stop geode-ui.service || true
    fi
fi

exit 0
```

- [ ] **Step 2: Make it executable and lint with shellcheck**

```bash
chmod +x scripts/packaging/preinstall.sh
shellcheck scripts/packaging/preinstall.sh
```

Expected: exit 0, no diagnostics.

- [ ] **Step 3: Commit**

```bash
git add scripts/packaging/preinstall.sh
git commit -m "feat(packaging): preinstall script (user/group + service stop)"
```

---

### Task 6: Add the postinstall script

**Files:**
- Create: `scripts/packaging/postinstall.sh`

- [ ] **Step 1: Author postinstall**

Write `scripts/packaging/postinstall.sh`:

```bash
#!/bin/sh
# Post-installation script for geode-ui.
#
# Responsibilities, in order:
#   1. Set ownership/perms on /var/lib/geode-ui, /var/log/geode-ui,
#      /etc/geode-ui.
#   2. If a co-resident geode install is detected AND no
#      /etc/geode-ui/seed-profiles.d/10-local-geode.json already
#      exists, write one pointing at quic://localhost:3141 so the
#      first `geode-ui` launch seeds it.
#   3. systemd daemon-reload + enable + start on fresh install; on
#      upgrade just daemon-reload + restart-if-was-running.

set -e

# 1. Ownership/perms. files were extracted root:root.
chown -R geode-ui:geode-ui /var/lib/geode-ui /var/log/geode-ui
chmod 750 /var/lib/geode-ui /var/log/geode-ui
# /etc/geode-ui is world-readable (config is non-sensitive); the seed
# JSON drop-ins are mode 0640 so the geode-ui user can read but other
# users cannot.
chown root:geode-ui /etc/geode-ui /etc/geode-ui/seed-profiles.d 2>/dev/null || true
chmod 750 /etc/geode-ui /etc/geode-ui/seed-profiles.d 2>/dev/null || true

# 2. Auto-seed local-geode profile when geode is co-installed.
DETECTOR="/usr/share/geode-ui/packaging/detect-local-geode.sh"
SEED_FILE="/etc/geode-ui/seed-profiles.d/10-local-geode.json"
if [ -x "$DETECTOR" ] && [ "$($DETECTOR)" = "1" ] && [ ! -f "$SEED_FILE" ]; then
    cat > "$SEED_FILE" <<'JSON'
[
  {
    "name": "local-geode",
    "dsn": "quic://localhost:3141?insecure_tls_skip_verify=true",
    "description": "Local geode service detected on this host at install time. Edit /api/v1/profiles to swap the DSN once TLS is wired up."
  }
]
JSON
    chown root:geode-ui "$SEED_FILE"
    chmod 0640 "$SEED_FILE"
    echo "geode-ui: detected co-resident geode; seeded 'local-geode' profile."
fi

# 3. systemd lifecycle.
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
    # `deb-systemd-helper` (debhelper) is the apt-preferred wrapper but
    # is not always present (rpm, apk, manual dpkg). Fall back to a
    # plain enable when missing.
    if command -v deb-systemd-helper >/dev/null 2>&1; then
        deb-systemd-helper enable geode-ui.service >/dev/null || true
    else
        systemctl enable geode-ui.service >/dev/null 2>&1 || true
    fi
    # On a fresh install the service has not been started. On an
    # upgrade preinstall stopped it; restart so the new binary runs.
    systemctl start geode-ui.service || true
fi

exit 0
```

- [ ] **Step 2: Lint with shellcheck**

```bash
chmod +x scripts/packaging/postinstall.sh
shellcheck scripts/packaging/postinstall.sh
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/packaging/postinstall.sh
git commit -m "feat(packaging): postinstall (perms + local-geode seed + systemd start)"
```

---

### Task 7: Add the preremove + postremove scripts

**Files:**
- Create: `scripts/packaging/preremove.sh`
- Create: `scripts/packaging/postremove.sh`

- [ ] **Step 1: Author preremove**

Write `scripts/packaging/preremove.sh`:

```bash
#!/bin/sh
# Pre-removal: stop and disable the service so the unit file can be
# removed cleanly. Idempotent.

set -e

if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet geode-ui.service; then
        systemctl stop geode-ui.service || true
    fi
    if command -v deb-systemd-helper >/dev/null 2>&1; then
        deb-systemd-helper disable geode-ui.service >/dev/null || true
    else
        systemctl disable geode-ui.service >/dev/null 2>&1 || true
    fi
fi

exit 0
```

- [ ] **Step 2: Author postremove**

Write `scripts/packaging/postremove.sh`:

```bash
#!/bin/sh
# Post-removal:
#   - `remove` (the default): leave /var/lib/geode-ui and
#     /var/log/geode-ui intact so a re-install keeps the operator's
#     profile store and uploads.
#   - `purge` (dpkg --purge): wipe /var/lib/geode-ui and
#     /var/log/geode-ui; the configs in /etc/geode-ui (marked
#     `config|noreplace` in the nfpm contents) are removed by dpkg.
#
# The action is the first argument on Debian and via $1 on rpm/apk too
# (nfpm normalises the contract).

set -e

action="${1:-remove}"

case "$action" in
    purge|0)
        rm -rf /var/lib/geode-ui /var/log/geode-ui
        if getent passwd geode-ui >/dev/null; then
            userdel geode-ui >/dev/null 2>&1 || true
        fi
        if getent group geode-ui >/dev/null; then
            groupdel geode-ui >/dev/null 2>&1 || true
        fi
        ;;
    remove|1|upgrade|2)
        : # keep data; user/group also stay so an upgrade preserves perms.
        ;;
esac

if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
fi

exit 0
```

- [ ] **Step 3: Lint both with shellcheck and commit**

```bash
chmod +x scripts/packaging/preremove.sh scripts/packaging/postremove.sh
shellcheck scripts/packaging/preremove.sh scripts/packaging/postremove.sh
git add scripts/packaging/preremove.sh scripts/packaging/postremove.sh
git commit -m "feat(packaging): preremove + postremove scripts"
```

---

### Task 8: Wire the new contents into .goreleaser.yaml

**Files:**
- Modify: `.goreleaser.yaml:374-437` (the `nfpms:` block)

- [ ] **Step 1: Replace the `nfpms:` block**

Open `.goreleaser.yaml` and replace the existing `nfpms:` block with:

```yaml
nfpms:
- id: geode-ui-packages
  package_name: geode-ui
  ids:
  - geode-ui
  vendor: CodePros
  homepage: https://gitlab.com/devnw/codepros/geode/geode-ui
  maintainer: Geode Team <geode@codepros.dev>
  description: |-
    Geode UI - admin web interface for the Geode graph database.

    Self-hosted Go binary serving a React SPA + JSON+WS API. Pairs with
    the Geode graph database (geodedb.com). When installed on a host
    that also carries the `geode` package, the postinstall seeds a
    `local-geode` profile pointing at quic://localhost:3141.
  license: Apache-2.0
  formats:
  - deb
  - rpm
  - apk
  bindir: /usr/bin
  section: database
  priority: optional
  provides:
  - geode-ui
  dependencies:
  - ca-certificates
  recommends:
    # Soft-suggest the geode server. apt installs both with one
    # command (`apt install geode geode-ui`) but does not pull geode
    # in implicitly.
  - geode
  file_name_template: >-
    {{ .ProjectName }}_{{ .Version }}_
    {{- if eq .Os "linux" }}Linux{{- else }}{{ title .Os }}{{ end }}_
    {{- if eq .Arch "amd64" }}x86_64
    {{- else if eq .Arch "arm64" }}arm64
    {{- else }}{{ .Arch }}{{ end }}
  scripts:
    preinstall: scripts/packaging/preinstall.sh
    postinstall: scripts/packaging/postinstall.sh
    preremove: scripts/packaging/preremove.sh
    postremove: scripts/packaging/postremove.sh
  contents:
    # Docs
  - src: README.md
    dst: /usr/share/doc/geode-ui/README.md
    file_info: { mode: 0644 }
  - src: LICENSE
    dst: /usr/share/doc/geode-ui/LICENSE
    file_info: { mode: 0644 }
  - src: docs/INSTALL.md
    dst: /usr/share/doc/geode-ui/INSTALL.md
    file_info: { mode: 0644 }

    # systemd unit
  - src: deployment/systemd/geode-ui.service
    dst: /lib/systemd/system/geode-ui.service
    file_info: { mode: 0644 }

    # EnvironmentFile + seed dir (config|noreplace so operator edits
    # survive upgrades).
  - src: deployment/config/geode-ui.conf
    dst: /etc/geode-ui/geode-ui.conf
    type: config|noreplace
    file_info: { mode: 0644 }
  - src: deployment/seed-profiles.d/README.md
    dst: /etc/geode-ui/seed-profiles.d/README.md
    file_info: { mode: 0644 }

    # detect-local-geode.sh (sourced from postinstall via the
    # canonical /usr/share path so it survives a chroot postinstall).
  - src: scripts/packaging/detect-local-geode.sh
    dst: /usr/share/geode-ui/packaging/detect-local-geode.sh
    file_info: { mode: 0755 }

    # Runtime dirs (empty, mode 0750 — postinstall fixes ownership).
  - dst: /var/lib/geode-ui
    type: dir
    file_info: { mode: 0750 }
  - dst: /var/lib/geode-ui/uploads
    type: dir
    file_info: { mode: 0750 }
  - dst: /var/log/geode-ui
    type: dir
    file_info: { mode: 0750 }
  - dst: /etc/geode-ui
    type: dir
    file_info: { mode: 0750 }
  - dst: /etc/geode-ui/seed-profiles.d
    type: dir
    file_info: { mode: 0750 }

  deb:
    compression: xz
  rpm:
    compression: xz
```

- [ ] **Step 2: Validate with `goreleaser check`**

```bash
goreleaser check
```

Expected: `config is valid`, exit 0.

- [ ] **Step 3: Snapshot-build the package locally and inspect**

```bash
goreleaser release --snapshot --clean --skip=docker,publish
ls dist/*.deb
dpkg-deb -c dist/geode-ui_*_Linux_x86_64.deb | grep -E "(systemd|geode-ui|packaging)"
```

Expected output (paths exact):
```
./lib/systemd/system/geode-ui.service
./etc/geode-ui/geode-ui.conf
./etc/geode-ui/seed-profiles.d/README.md
./usr/bin/geode-ui
./usr/share/geode-ui/packaging/detect-local-geode.sh
./usr/share/doc/geode-ui/...
```

- [ ] **Step 4: Commit**

```bash
git add .goreleaser.yaml
git commit -m "build(packaging): wire systemd unit + scriptlets into nfpm contents"
```

---

## Phase 2 — Server-side seed-profiles.d drop-in support

### Task 9: TDD the drop-in scanner

**Files:**
- Create: `cmd/server/profileseed_dropin.go`
- Create: `cmd/server/profileseed_dropin_test.go`
- Modify: `cmd/server/app.go:79-80` (flag), `cmd/server/app.go:252` (call site)

- [ ] **Step 1: Write the failing test**

Write `cmd/server/profileseed_dropin_test.go`:

```go
package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

func TestSeedFromDropInDir_lexicographicOrder(t *testing.T) {
	dir := t.TempDir()
	// Write three drop-ins out of lexicographic order.
	must := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must("20-second.json", `[{"name":"second","dsn":"quic://b:3141"}]`)
	must("10-first.json", `[{"name":"first","dsn":"quic://a:3141"}]`)
	must("99-last.json", `[{"name":"last","dsn":"quic://c:3141"}]`)

	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 profiles, got %d", len(got))
	}
	wantNames := []string{"first", "second", "last"}
	for i, p := range got {
		if p.Name != wantNames[i] {
			t.Errorf("profile[%d] name = %q, want %q", i, p.Name, wantNames[i])
		}
		if p.Scope != conn.ProfileScopeSystem {
			t.Errorf("profile[%d] scope = %q, want system", i, p.Scope)
		}
	}
}

func TestSeedFromDropInDir_emptyDir(t *testing.T) {
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, t.TempDir()); err != nil {
		t.Fatalf("empty dir should be a no-op, got %v", err)
	}
}

func TestSeedFromDropInDir_missingDir(t *testing.T) {
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, "/nonexistent/dir"); err != nil {
		t.Fatalf("missing dir should be a no-op (silently), got %v", err)
	}
}

func TestSeedFromDropInDir_ignoresNonJSON(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# notes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "10-ok.json"), []byte(`[{"name":"only","dsn":"quic://x:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "only" {
		t.Fatalf("non-json should be ignored, got %v", got)
	}
}

func TestSeedFromDropInDir_invalidJSONFails(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "10-bad.json"), []byte(`not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	err := seedFromDropInDir(context.Background(), store, dir)
	if err == nil {
		t.Fatalf("expected error on invalid json")
	}
}

func TestSeedFromDropInDir_firstWinsOnNameCollision(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "10-first.json"), []byte(`[{"name":"x","dsn":"quic://a:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "20-second.json"), []byte(`[{"name":"x","dsn":"quic://b:3141"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := mustOpenStore(t)
	if err := seedFromDropInDir(context.Background(), store, dir); err != nil {
		t.Fatal(err)
	}
	got, err := store.List(context.Background(), profilestore.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 (first-wins), got %d: %v", len(got), got)
	}
	if got[0].DSN != "quic://a:3141" {
		t.Errorf("first-wins violated: got dsn=%q, want quic://a:3141", got[0].DSN)
	}
}
```

Helper used in the tests (`mustOpenStore`) wraps the existing
`profilestore.OpenSQLite(":memory:")` constructor with a `t.Cleanup` for the
`Close`. Add it once at the top of `profileseed_dropin_test.go`:

```go
func mustOpenStore(t *testing.T) profilestore.Store {
	t.Helper()
	s, err := profilestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
go test ./cmd/server/ -run TestSeedFromDropInDir -v
```

Expected: compile error `undefined: seedFromDropInDir`.

- [ ] **Step 3: Implement `seedFromDropInDir`**

Write `cmd/server/profileseed_dropin.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"geodedb.com/geode-ui/internal/conn"
	"geodedb.com/geode-ui/internal/profilestore"
)

// seedFromDropInDir reads every *.json file in `dir` in
// lexicographic-by-filename order and seeds each entry into `store` as
// scope=system, the same shape as the legacy -profiles JSON flag.
//
// Semantics:
//   - Missing dir → silent no-op (the package's seed-profiles.d may
//     legitimately not exist on a manual binary install).
//   - Non-empty store → silent no-op (matches seedFromJSON: drop-ins
//     only seed an empty store).
//   - Non-*.json files → ignored (README.md, swp files, dotfiles).
//   - Invalid JSON → loud error (operator misconfiguration; the unit
//     fails to start, which is what the operator wants — a half-
//     seeded store hides the bug).
//   - Duplicate profile name across files → first-wins (lex-earlier
//     file's entry is kept; later collisions are dropped with a debug
//     log line).
//
// The 10-, 20-, 99- prefix convention matches systemd / udev / cron
// drop-in directories. Operators add a higher-prefix file to override
// a default; first-wins on the NAME makes that scheme deterministic.
func seedFromDropInDir(ctx context.Context, store profilestore.Store, dir string) error {
	existing, err := store.List(ctx, profilestore.Filter{})
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("readdir %q: %w", dir, err)
	}

	files := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		files = append(files, e.Name())
	}
	sort.Strings(files)

	seen := make(map[string]struct{}, 8)
	for _, fname := range files {
		path := filepath.Join(dir, fname)
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %q: %w", path, err)
		}
		var batch []conn.Profile
		if err := json.Unmarshal(raw, &batch); err != nil {
			return fmt.Errorf("parse %q: %w", path, err)
		}
		for _, p := range batch {
			if _, dup := seen[p.Name]; dup {
				continue
			}
			seen[p.Name] = struct{}{}
			p.Scope = conn.ProfileScopeSystem
			p.OwnerUserID = ""
			if err := loadTLSFiles(&p); err != nil {
				return fmt.Errorf("load tls for %q in %q: %w", p.Name, path, err)
			}
			if _, err := store.Put(ctx, p); err != nil {
				return fmt.Errorf("seed %q from %q: %w", p.Name, path, err)
			}
		}
	}
	return nil
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
go test ./cmd/server/ -run TestSeedFromDropInDir -v
```

Expected: 6 PASS, 0 FAIL.

- [ ] **Step 5: Commit**

```bash
git add cmd/server/profileseed_dropin.go cmd/server/profileseed_dropin_test.go
git commit -m "feat(server): scan seed-profiles.d/*.json drop-ins on first launch"
```

---

### Task 10: Wire the flag + call site

**Files:**
- Modify: `cmd/server/app.go:79-80`
- Modify: `cmd/server/app.go:252`

- [ ] **Step 1: Write a failing test that asserts the flag exists with the right default**

Append to `cmd/server/app_test.go`:

```go
func TestParseFlags_ProfileSeedDirDefault(t *testing.T) {
	cfg, err := parseFlags([]string{"geode-ui"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.profileSeedDir != "/etc/geode-ui/seed-profiles.d" {
		t.Errorf("default seed dir = %q, want /etc/geode-ui/seed-profiles.d", cfg.profileSeedDir)
	}
}

func TestParseFlags_ProfileSeedDirOverride(t *testing.T) {
	cfg, err := parseFlags([]string{"geode-ui", "-profile-seed-dir", "/tmp/seeds"}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.profileSeedDir != "/tmp/seeds" {
		t.Errorf("override seed dir = %q, want /tmp/seeds", cfg.profileSeedDir)
	}
}
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
go test ./cmd/server/ -run TestParseFlags_ProfileSeedDir -v
```

Expected: compile error `cfg.profileSeedDir undefined`.

- [ ] **Step 3: Add the field + flag**

In `cmd/server/app.go` near the existing `profilesFile` field (around line 43), add:

```go
profileSeedDir       string
```

In `parseFlags` immediately after the existing `cfg.profilesFile` declaration, add:

```go
fs.StringVar(&cfg.profileSeedDir, "profile-seed-dir", "/etc/geode-ui/seed-profiles.d", "directory scanned for *.json profile seed drop-ins on first launch (only when -profile-store is empty); matches the apt package's /etc/geode-ui/seed-profiles.d convention")
```

- [ ] **Step 4: Wire the call site**

In `newApp` (around line 252) replace the existing `seedFromJSON` call block:

```go
	if err := seedFromJSON(context.Background(), store, profiles); err != nil {
		return nil, fmt.Errorf("seed profiles: %w", err)
	}
```

with:

```go
	if err := seedFromJSON(context.Background(), store, profiles); err != nil {
		return nil, fmt.Errorf("seed profiles: %w", err)
	}
	if cfg.profileSeedDir != "" {
		if err := seedFromDropInDir(context.Background(), store, cfg.profileSeedDir); err != nil {
			return nil, fmt.Errorf("seed profiles drop-in: %w", err)
		}
	}
```

- [ ] **Step 5: Run the tests — confirm all pass**

```bash
go test ./cmd/server/ -v
```

Expected: all tests including the two new flag tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cmd/server/app.go cmd/server/app_test.go
git commit -m "feat(server): -profile-seed-dir flag + call seedFromDropInDir on first launch"
```

---

## Phase 3 — Electron .deb rename

### Task 11: Rename the electron-builder deb

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Edit the linux block**

In `electron-builder.yml` replace the existing `linux:` block:

```yaml
linux:
  target:
  - target: AppImage
    arch: [x64, arm64]
  - target: deb
    arch: [x64, arm64]
  category: Development
  artifactName: geode-ui-desktop_${version}_${arch}.${ext}
  executableName: geode-ui-desktop
```

Add at the end of the file:

```yaml
deb:
  # Avoid the "geode" name collision with the upstream graph-database
  # apt package. The package name is the artifactName base; depends
  # stays empty because the desktop app talks to any reachable geode-
  # ui origin, not necessarily a locally-installed one.
  packageName: geode-ui-desktop
  depends: []
  # Recommend the headless service so apt suggests "install both for
  # the all-on-one-host experience" without forcing it.
  recommends:
  - geode-ui
```

Update `productName` at the top of the file from `Geode` to `Geode UI Desktop` so the .desktop file label matches the new artifact name.

- [ ] **Step 2: Build the electron .deb locally and verify the new filename**

```bash
npm run electron:linux
ls release/linux/*.deb
```

Expected: `release/linux/geode-ui-desktop_<version>_amd64.deb`.

- [ ] **Step 3: Inspect the .deb for the renamed binary**

```bash
dpkg-deb -c release/linux/geode-ui-desktop_*_amd64.deb | grep "/usr/bin/"
```

Expected: a single line ending in `/usr/bin/geode-ui-desktop`.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml
git commit -m "build(electron): rename .deb to geode-ui-desktop to avoid geode collision"
```

---

### Task 12: Update CHANGELOG with the rename

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the entry**

Add to the top of `CHANGELOG.md` (under the unreleased section, creating it if missing):

```markdown
## Unreleased

### Breaking Changes

- Electron `.deb` renamed: the desktop installer is now published as
  `geode-ui-desktop_<version>_<arch>.deb` (was `geode_<version>_<arch>.deb`).
  The binary inside is `/usr/bin/geode-ui-desktop`. This avoids the
  collision with the upstream `geode` graph-database package.
  Migration: `sudo apt remove geode && sudo apt install ./geode-ui-desktop_*.deb`
  (uninstall the previous-name package, then install the renamed one;
  user data lives in `~/.config/geode-ui-desktop` going forward —
  electron migrates the old `~/.config/Geode` directory on first run).

### Features

- New `geode-ui` apt package: `apt install geode-ui` produces a working
  systemd service that listens on 127.0.0.1:8080 and serves the SPA +
  API. The postinstall detects a co-resident `geode` install and seeds
  a `local-geode` profile pointing at `quic://localhost:3141`.
- New `-profile-seed-dir` flag (default `/etc/geode-ui/seed-profiles.d`)
  scans the directory for `*.json` profile seed drop-ins on first
  launch. Drop-ins are loaded in lexicographic order with first-wins
  semantics on duplicate names; existing stores are left untouched.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): apt-installable geode-ui + electron .deb rename"
```

---

## Phase 4 — CI: publish the new .deb to the apt repo

### Task 13: Wire the new artifact into the apt-repo job

**Files:**
- Modify: `.gitlab-ci.yml` (or `.github/workflows/release.yml` — whichever exists)

- [ ] **Step 1: Locate the existing apt-repo job**

```bash
grep -nE "(apt-repo|generate-apt-repo|nfpm|nfpms)" .gitlab-ci.yml .github/workflows/*.yml 2>/dev/null
```

If the project has no apt-repo job today, mirror `../geode/scripts/packaging/generate-apt-repo.sh` (single shell script that builds an `apt-archive/` layout and uploads to the project's GitLab Pages / static-storage bucket).

- [ ] **Step 2: Add the geode-ui artifacts to the apt-repo build**

Whatever step today collects `dist/geode_*.deb` from the goreleaser job must additionally collect `dist/geode-ui_*.deb`. The pattern is usually:

```yaml
script:
  - cp dist/geode-ui_*.deb apt-archive/pool/main/g/geode-ui/
  - cd apt-archive && dpkg-scanpackages -m pool/ /dev/null > dists/stable/main/binary-amd64/Packages
  - ...
```

If `../geode`'s repo script is reusable, source it: `bash ../geode/scripts/packaging/generate-apt-repo.sh dist/geode-ui_*.deb`. Either way, after the job runs the published apt-repo's `Packages` file MUST list both `geode` and `geode-ui`.

- [ ] **Step 3: Add a smoke test that fetches and installs from the staged repo**

Append to the release pipeline:

```yaml
apt-install-smoke:
  stage: validate
  image: debian:bookworm
  needs: [apt-repo]
  script:
    - apt-get update && apt-get install -y curl ca-certificates
    - echo "deb [trusted=yes] $CI_PAGES_URL stable main" > /etc/apt/sources.list.d/geode.list
    - apt-get update
    - apt-get install -y geode-ui
    - systemctl --version  # confirm we're on a systemd image; if not, sd-stub is fine
    - /usr/bin/geode-ui -h
    - test -f /etc/geode-ui/geode-ui.conf
    - test -f /lib/systemd/system/geode-ui.service
```

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: publish geode-ui_*.deb to apt repo + add install smoke job"
```

---

## Phase 5 — Documentation

### Task 14: Author `docs/INSTALL.md`

**Files:**
- Create: `docs/INSTALL.md`

- [ ] **Step 1: Write the operator-facing install guide**

Write `docs/INSTALL.md`:

````markdown
# Installing Geode UI

Geode UI ships in two complementary packages:

| Package | Audience | Install |
|---|---|---|
| `geode-ui` | Headless service (run alongside `geode` on a server or workstation). systemd-managed; listens on 127.0.0.1:8080 by default. | `sudo apt install geode-ui` |
| `geode-ui-desktop` | Electron desktop wrapper. Talks to any reachable `geode-ui` HTTP origin. | `sudo apt install ./geode-ui-desktop_<version>_<arch>.deb` |

Most operators install both: `geode-ui` runs the API server, and
`geode-ui-desktop` is the GUI that connects to it.

## 1. Headless service via apt (Debian/Ubuntu)

```bash
# Add the Geode apt repository (one-time).
curl -fsSL https://gitlab.com/devnw/codepros/geode/geode-ui/-/raw/main/deployment/apt-key.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/geode-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/geode-archive-keyring.gpg] https://apt.geodedb.com stable main" \
  | sudo tee /etc/apt/sources.list.d/geode.list

# Install the service.
sudo apt update
sudo apt install geode-ui
```

The postinstall:
1. Creates the `geode-ui` system user.
2. Drops `/lib/systemd/system/geode-ui.service` and enables it.
3. If `geode` is installed on the same host, writes
   `/etc/geode-ui/seed-profiles.d/10-local-geode.json` pointing at
   `quic://localhost:3141`. On first launch the server seeds this as
   a `scope=system` profile so the SPA shows it in the connection
   picker out of the box.
4. Starts `geode-ui.service`. Verify with:

```bash
systemctl status geode-ui.service
curl http://127.0.0.1:8080/api/v1/healthz
```

## 2. Headless service via direct dpkg

```bash
curl -fLO https://gitlab.com/devnw/codepros/geode/geode-ui/-/releases/v<version>/downloads/geode-ui_<version>_Linux_x86_64.deb
sudo dpkg -i geode-ui_<version>_Linux_x86_64.deb
```

## 3. Desktop app via apt

```bash
sudo apt install geode-ui-desktop
geode-ui-desktop  # launches the electron window
```

If `geode-ui` is also installed locally, the desktop app auto-connects
to `http://127.0.0.1:8080`. To point at a remote host, set the
`GEODE_SERVER_URL` env var (e.g. via a `.desktop` file or a wrapper
script).

## 4. Co-resident with `geode`

The intended pairing is `apt install geode geode-ui` on the same host:

```bash
sudo apt install geode geode-ui
```

apt installs both binaries, starts both systemd services, and the
geode-ui postinstall seeds the local-geode profile. Open the SPA at
`http://127.0.0.1:8080` and the connection picker already shows
`local-geode`.

## 5. Configuration

Edit `/etc/geode-ui/geode-ui.conf` and restart:

```bash
sudo systemctl restart geode-ui.service
```

The conf file documents every knob inline. Common overrides:
- `GEODE_UI_LISTEN=0.0.0.0:8080` to expose on the LAN.
- `GEODE_UI_PROFILE_SEED_DIR=` to disable the drop-in scanner.

## 6. Removal

```bash
sudo apt remove geode-ui        # stops + removes the service; keeps /var/lib/geode-ui
sudo apt purge geode-ui         # also wipes profile store + uploads
```
````

- [ ] **Step 2: Commit**

```bash
git add docs/INSTALL.md
git commit -m "docs: operator-facing INSTALL.md covering apt + dpkg + desktop paths"
```

---

### Task 15: Update README + RELEASE.md

**Files:**
- Modify: `README.md`
- Modify: `docs/RELEASE.md`

- [ ] **Step 1: Add an "Install" section near the top of README.md**

Locate the first `## ` heading in `README.md` and insert immediately above it:

```markdown
## Install

```bash
sudo apt install geode-ui              # headless service (systemd-managed)
sudo apt install geode-ui-desktop      # electron GUI (recommended on workstations)
```

When installed alongside `geode`, the postinstall seeds a
`local-geode` profile so the SPA's connection picker is non-empty on
first launch. Full install paths (apt repo bootstrap, direct dpkg,
co-resident setup) are documented in [docs/INSTALL.md](docs/INSTALL.md).
```

- [ ] **Step 2: Add a release-process note to `docs/RELEASE.md`**

Append to `docs/RELEASE.md`:

```markdown
## Two-package release contract

The geode-ui repo emits TWO debian packages per release:

| Built by | Filename | Installs |
|---|---|---|
| goreleaser (`.goreleaser.yaml` nfpms) | `geode-ui_<version>_Linux_<arch>.deb` | `/usr/bin/geode-ui` + systemd unit + `/etc/geode-ui/`. |
| electron-builder (`electron-builder.yml`) | `geode-ui-desktop_<version>_<arch>.deb` | `/usr/bin/geode-ui-desktop` + `.desktop` launcher. |

Both .deb files are uploaded to the same GitLab Release page and to
the public apt repo. The apt-repo `Packages` file lists both under
distinct `Package:` names. Operators may install either or both.

### Postinstall geode-detection

`geode-ui`'s postinstall runs
`/usr/share/geode-ui/packaging/detect-local-geode.sh` and, on a
positive hit, writes `10-local-geode.json` into
`/etc/geode-ui/seed-profiles.d/`. The detector is filesystem-only
(no network probe) so it works in chrooted package-build environments.
The server-side scan that picks the drop-in up lives in
`cmd/server/profileseed_dropin.go`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/RELEASE.md
git commit -m "docs: README install section + RELEASE.md two-package contract"
```

---

## Phase 6 — End-to-end smoke test

### Task 16: Author the apt-install smoke test

**Files:**
- Create: `tests/packaging/apt-install-smoke.sh`

- [ ] **Step 1: Author the smoke test**

Write `tests/packaging/apt-install-smoke.sh`:

```bash
#!/bin/sh
# tests/packaging/apt-install-smoke.sh
#
# End-to-end smoke test for the apt install path. Run on a clean
# debian:bookworm container. Asserts every release-critical invariant:
#
#   1. The .deb installs cleanly with no prompts.
#   2. The geode-ui user is created.
#   3. The systemd unit file is dropped (or sd-stub equivalent on
#      container hosts without systemd-pid1).
#   4. The binary runs and serves /api/v1/healthz=200.
#   5. With /usr/bin/geode pre-staged (simulated co-resident geode),
#      the postinstall writes /etc/geode-ui/seed-profiles.d/10-local-geode.json.
#   6. Removing the package preserves /var/lib/geode-ui; purging wipes it.
#
# Invoke:
#   docker run --rm -v "$PWD:/src" -w /src debian:bookworm \
#       tests/packaging/apt-install-smoke.sh dist/geode-ui_*_Linux_x86_64.deb

set -eu

DEB="${1:?usage: $0 <path-to-geode-ui-deb>}"
test -f "$DEB" || { echo "deb not found: $DEB"; exit 1; }

apt-get update >/dev/null
apt-get install -y --no-install-recommends curl ca-certificates >/dev/null

# Pre-stage a fake /usr/bin/geode so the detector positive-case fires.
mkdir -p /usr/bin
echo '#!/bin/sh' > /usr/bin/geode
chmod +x /usr/bin/geode

# 1. Install.
apt-get install -y "$DEB"

# 2. User.
getent passwd geode-ui >/dev/null

# 3. Unit + config.
test -f /lib/systemd/system/geode-ui.service
test -f /etc/geode-ui/geode-ui.conf
test -d /etc/geode-ui/seed-profiles.d

# 5. Seeded local-geode profile.
test -f /etc/geode-ui/seed-profiles.d/10-local-geode.json
grep -q '"name": "local-geode"' /etc/geode-ui/seed-profiles.d/10-local-geode.json
grep -q 'quic://localhost:3141' /etc/geode-ui/seed-profiles.d/10-local-geode.json

# 4. Binary runs & serves health. We start it manually (no systemd-pid1
# in the container) and curl the health endpoint, then SIGTERM it.
/usr/bin/geode-ui \
    -listen=127.0.0.1:18080 \
    -profile-store=:memory: \
    -profile-seed-dir=/etc/geode-ui/seed-profiles.d \
    -upload-dir=/tmp/geode-ui-uploads \
    -jwt-secret-hex=$(openssl rand -hex 32) &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

# Poll for readiness (up to 10s).
for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:18080/api/v1/healthz >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
curl -fsS http://127.0.0.1:18080/api/v1/healthz >/dev/null

# 6a. Remove (default action) — data preserved.
kill "$PID" || true
apt-get remove -y geode-ui
test -d /var/lib/geode-ui || { echo "FAIL: /var/lib/geode-ui removed on apt remove"; exit 1; }

# 6b. Purge — data wiped.
apt-get purge -y geode-ui
test ! -d /var/lib/geode-ui || { echo "FAIL: /var/lib/geode-ui persisted past purge"; exit 1; }
getent passwd geode-ui >/dev/null && { echo "FAIL: geode-ui user persisted past purge"; exit 1; } || true

echo "OK: apt-install-smoke.sh passed."
```

- [ ] **Step 2: Make it executable, run it locally**

```bash
chmod +x tests/packaging/apt-install-smoke.sh
goreleaser release --snapshot --clean --skip=docker,publish
docker run --rm -v "$PWD:/src" -w /src debian:bookworm \
    tests/packaging/apt-install-smoke.sh dist/geode-ui_*_Linux_x86_64.deb
```

Expected: final line `OK: apt-install-smoke.sh passed.`

- [ ] **Step 3: Commit**

```bash
git add tests/packaging/apt-install-smoke.sh
git commit -m "test(packaging): apt-install end-to-end smoke (user, units, seed, health, purge)"
```

---

### Task 17: Wire the smoke test into CI

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Add the job**

Add to `.gitlab-ci.yml`:

```yaml
apt-install-smoke:
  stage: test
  image: debian:bookworm
  needs: [release]   # waits for goreleaser to publish dist/ artifacts
  script:
    - tests/packaging/apt-install-smoke.sh dist/geode-ui_*_Linux_x86_64.deb
  artifacts:
    when: on_failure
    paths:
    - /var/log/geode-ui/
    expire_in: 1 week
```

- [ ] **Step 2: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: run apt-install-smoke against every release build"
```

---

## Phase 7 — Final verification

### Task 18: Full local rehearsal

- [ ] **Step 1: Snapshot release locally**

```bash
goreleaser release --snapshot --clean --skip=docker,publish
ls dist/*.deb
```

Expected: at minimum `dist/geode-ui_<version>_Linux_x86_64.deb` and `dist/geode-ui_<version>_Linux_arm64.deb`.

- [ ] **Step 2: Run the smoke test**

```bash
docker run --rm -v "$PWD:/src" -w /src debian:bookworm \
    tests/packaging/apt-install-smoke.sh dist/geode-ui_*_Linux_x86_64.deb
```

Expected: `OK: apt-install-smoke.sh passed.`

- [ ] **Step 3: Build the electron .deb and confirm the rename**

```bash
npm run electron:linux
ls release/linux/*.deb
```

Expected: `release/linux/geode-ui-desktop_<version>_amd64.deb` (and arm64). No `geode_*.deb` is emitted anymore.

- [ ] **Step 4: Verify the full jest + go test + lint suites still pass**

```bash
go test ./...
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Confirm goreleaser config validates clean**

```bash
goreleaser check
```

Expected: `config is valid`.

- [ ] **Step 6: Final commit (only if any cleanup was needed in this step)**

If steps 1-5 surfaced any drift (missing fixture, lint nit), fix and commit:

```bash
git add -p
git commit -m "chore(packaging): final cleanup from Task 18 rehearsal"
```

---

## Self-Review Checklist

After implementing every task above, walk this list before opening the MR:

- [ ] `apt install geode-ui` on a fresh debian:bookworm produces a running `geode-ui.service` listening on 127.0.0.1:8080.
- [ ] When `geode` is installed on the same host, the SPA's connection picker shows `local-geode` on first load (no manual profile creation).
- [ ] `apt install geode-ui-desktop` does NOT collide with `apt install geode`.
- [ ] The electron .deb's binary is at `/usr/bin/geode-ui-desktop`, not `/usr/bin/geode`.
- [ ] `apt remove geode-ui` keeps `/var/lib/geode-ui`; `apt purge geode-ui` wipes it AND drops the system user.
- [ ] `cmd/server/profileseed_dropin_test.go` covers: lex order, empty dir, missing dir, non-json, invalid json, first-wins on dup.
- [ ] CHANGELOG documents the electron .deb rename as a breaking change with the upgrade path.
- [ ] `docs/INSTALL.md` is linked from the README and covers all four install paths (apt, dpkg, desktop, co-resident).
- [ ] The new CI smoke job (`apt-install-smoke`) runs against every release.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-23-apt-install-geode-ui.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the tasks touch unfamiliar packaging surfaces (nfpm, systemd, dpkg scriptlets) where one subagent's cold-read of each task is closer to the install-time reality than a single long session.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
