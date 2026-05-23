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
