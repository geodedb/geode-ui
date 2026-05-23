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
