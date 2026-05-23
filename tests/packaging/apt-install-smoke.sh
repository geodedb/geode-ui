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
apt-get install -y --no-install-recommends curl ca-certificates openssl >/dev/null

# Pre-stage a fake /usr/bin/geode so the detector positive-case fires.
mkdir -p /usr/bin
printf '#!/bin/sh\n' > /usr/bin/geode
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
    -jwt-secret-hex="$(openssl rand -hex 32)" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

# Poll for readiness (up to 10s).
i=0
while [ "$i" -lt 20 ]; do
    if curl -fsS http://127.0.0.1:18080/api/v1/healthz >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
    i=$((i + 1))
done
curl -fsS http://127.0.0.1:18080/api/v1/healthz >/dev/null

# 6a. Remove (default action) — data preserved.
kill "$PID" || true
apt-get remove -y geode-ui
test -d /var/lib/geode-ui || { echo "FAIL: /var/lib/geode-ui removed on apt remove"; exit 1; }

# 6b. Purge — data wiped.
apt-get purge -y geode-ui
test ! -d /var/lib/geode-ui || { echo "FAIL: /var/lib/geode-ui persisted past purge"; exit 1; }
if getent passwd geode-ui >/dev/null 2>&1; then
    echo "FAIL: geode-ui user persisted past purge"; exit 1
fi

echo "OK: apt-install-smoke.sh passed."
