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
#
# `/var/lib/geode-ui` and `/var/log/geode-ui` are NOT shipped in the
# package (see .goreleaser.yaml). dpkg deletes any empty
# package-owned dir on `apt remove`, which would wipe an
# operator's data-store on a non-purge remove if the dir happened
# to be empty (smoke-test path, or a fresh install that hasn't
# run yet). Creating the dirs here keeps them off the dpkg
# ownership ledger so they survive `apt remove` and are only
# cleared by postremove's explicit `purge` branch.
mkdir -p /var/lib/geode-ui /var/lib/geode-ui/uploads /var/log/geode-ui
chown -R geode-ui:geode-ui /var/lib/geode-ui /var/log/geode-ui
chmod 750 /var/lib/geode-ui /var/log/geode-ui
chmod 750 /var/lib/geode-ui/uploads
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
