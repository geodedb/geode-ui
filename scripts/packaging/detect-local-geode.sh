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
