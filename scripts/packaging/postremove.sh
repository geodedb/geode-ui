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
