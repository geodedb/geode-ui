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
