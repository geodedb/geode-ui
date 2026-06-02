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

## Shipped drop-ins

- `30-codepros-qa-prod.json` — the codepros hosted clusters
  (`prod.geodedb.com`, default; `qa.geodedb.com`). Host-only DSNs: log in
  with your geode credentials. The Kubernetes deployment uses a Vault-rendered
  variant with credentials embedded in the DSN — see
  `geode-argo-arda/manifests/geode-ui/externalsecret.yaml`.
