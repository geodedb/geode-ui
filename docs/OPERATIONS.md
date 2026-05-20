# Operations Runbook — geode-ui

Production-operational procedures for the geode-ui server. If a procedure
here lacks evidence (test, audit-event proof, rollback step), edit it
rather than working around it.

## JWT secret rotation (SEC-NEW-7 / #210)

The geode-ui server signs every issued JWT with an HS256 key chosen by
a `kid` (key ID) header stamp. Operators can rotate the signing secret
without invalidating in-flight tokens by running the server with two
secrets at once — the previous and the current — and only flipping the
active kid to point at the new key. After one full JWT TTL window
(default 8 hours), every legacy token has expired and the previous
secret can be dropped.

### Configuration surfaces

Two equivalent ways to supply secrets:

| Source | Variable | Purpose |
|---|---|---|
| Env (rotation-aware) | `JWT_SECRET_HEX_CURRENT` | active signing key — stamped on every newly-issued token under `kid="current"` |
| Env (rotation-aware) | `JWT_SECRET_HEX_PREVIOUS` | optional — verification key for tokens issued before the rotation, indexed under `kid="previous"` |
| CLI (legacy) | `-jwt-secret-hex` | single-secret backward-compatible mode; stamped under `kid="current"` |

Whenever `JWT_SECRET_HEX_CURRENT` is set, it wins regardless of the CLI
flag. This is so an existing deployment whose unit file passes
`-jwt-secret-hex` can flip into rotation mode by setting two env vars
without rewriting the unit file.

Both env vars must be **hex-encoded 32-byte HS256 secrets**:

```bash
openssl rand -hex 32
```

### Rotation procedure

The following sequence rotates a deployment from secret `S_old` to
secret `S_new` with zero session disruption. It assumes a JWT TTL of
8 hours; adjust the wait window if your TTL is different.

#### Step 1: generate a fresh secret

```bash
S_new=$(openssl rand -hex 32)
echo "$S_new"  # store in your secrets manager — you will need it twice
```

#### Step 2: deploy in dual-secret mode

Set BOTH env vars on every replica, with PREVIOUS = the existing secret
(your old `-jwt-secret-hex` value) and CURRENT = the new secret:

```bash
export JWT_SECRET_HEX_PREVIOUS="<the existing secret>"
export JWT_SECRET_HEX_CURRENT="$S_new"
# Restart geode-ui (rolling restart is fine; both states are valid).
```

After restart, the server:

- **Signs** every new token with `S_new` (stamped `kid="current"`).
- **Verifies** tokens stamped `kid="previous"` against `S_old`.
- **Verifies** tokens stamped `kid="current"` against `S_new`.
- **Rejects** tokens stamped with any other `kid` value.

A correctly-configured replica will accept both old AND new tokens for
the duration of the rotation window.

#### Step 3: wait one full JWT TTL window

After `1 × jwtTTL` (default 8 hours), every legacy token signed under
`S_old` has expired by RFC 7519 `exp` semantics — the previous secret
is no longer needed for verification.

If you cannot wait the full TTL (e.g. you need to rotate immediately
because the previous secret is compromised), use the durable JWT
revocation primitive (SEC-N2 / #64) to RevokeUser every active session
instead — that is faster but invalidates every active session, which
is what you would do for a known-compromise event anyway.

#### Step 4: drop the previous secret

```bash
unset JWT_SECRET_HEX_PREVIOUS
# Restart geode-ui (rolling restart).
```

After restart, the server holds only `S_new` and refuses any token
stamped with `kid="previous"`. Rotation is complete.

### Verification

Two quick smoke checks confirm a rotation deployment:

1. **`kid` header on a freshly-issued token.** Log into the SPA after
   the rotation deploy, then `curl -i` `/api/v1/whoami` with the
   resulting JWT — the header should be base64-decodeable to
   `{"alg":"HS256","kid":"current","typ":"JWT"}`.

2. **Dual verification.** Mint a token before the rotation deploy
   (kid="current" pointing at `S_old`), redeploy with the rotation
   env vars, then re-verify the OLD token against the new replica —
   it should still succeed for the duration of the rotation window.
   When the previous secret is dropped (Step 4), the OLD token must
   be rejected with `401`.

### Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `jwt: unknown kid "<value>"` on every request | client cached a token stamped with a kid the server no longer knows | client must re-login; (alt) re-add the previous secret to the env to extend the rotation window |
| Server refuses to start with `decode JWT_SECRET_HEX_CURRENT` | env var is not a valid 32-byte hex string | regenerate via `openssl rand -hex 32` and re-set |
| Server refuses to start with `jwt: secret for kid "previous" must be at least 32 bytes` | `JWT_SECRET_HEX_PREVIOUS` was truncated or set to the wrong value | retrieve the original `S_old` from the secrets manager |

### Audit events to monitor

During a rotation window, the audit log should show:

- `audit_event=auth_login` with the JWT subject — normal traffic, both
  kids accepted.
- `audit_event=admin_bootstrap` once on each replica restart (SEC-NEW-2 /
  #202).
- An absence of `kid: unknown` parse errors at the server log level
  — every well-formed token should land in either the previous or the
  current secret.

## Profile store key rotation (SEC-NEW-8 / #211)

The profile store columns holding DSN strings and TLS PEM material are
encrypted at rest with AES-256-GCM using `GEODE_PROFILESTORE_KEY`
(base64-encoded 32 bytes). To rotate the key, see the
`-profilestore-rewrap-from <hex>` one-shot startup sweep — set the new
key in `GEODE_PROFILESTORE_KEY`, pass the OLD key via the flag, and
the server re-seals every encrypted column on boot before serving any
request.

### Rotation procedure

```bash
# 1. Snapshot the database first.
cp /var/lib/geode-ui/profiles.db /var/lib/geode-ui/profiles.db.bak.$(date +%Y%m%d-%H%M%S)

# 2. Generate the new key.
NEW_KEY=$(openssl rand -base64 32)
OLD_KEY="<the previous GEODE_PROFILESTORE_KEY>"

# 3. Run the rewrap sweep (server exits 0 on success).
GEODE_PROFILESTORE_KEY="$NEW_KEY" \
  /usr/local/bin/geode-ui \
  -jwt-secret-hex "$(openssl rand -hex 32)" \
  -profilestore-rewrap-from "$OLD_KEY"

# 4. Restart the production server with only the NEW key.
GEODE_PROFILESTORE_KEY="$NEW_KEY" systemctl restart geode-ui
```

The rewrap sweep is idempotent: re-running it with the same key yields
zero re-seals and exits 0. A row that is already sealed under the new
key (e.g. created between Step 1 and Step 3) passes through unchanged.

### Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `profile store rewrap: decode legacy key` | `-profilestore-rewrap-from` was malformed | re-pass the OLD key as base64-encoded 32 bytes |
| `profile store rewrap: cipher mismatch` | a row in the DB was not sealed under the supplied OLD key | restore from the pre-rotation snapshot, audit which row drifted, and re-run |

---

## Geode metrics dashboard

The Dashboard page surfaces the upstream geode database's Prometheus
metrics when the operator enables the metrics listener on the geode
server AND points geode-ui at it. When either is missing the metric
cards drop out of the grid entirely — there is no broken/half-rendered
state.

### Configuration

Two environment variables wire the data path:

| Service  | Env var              | Value                              | Effect |
|----------|----------------------|------------------------------------|--------|
| `geode`  | `GEODE_METRICS_PORT` | `9090` (or any free port)          | Starts the geode prometheus HTTP listener on the named port. |
| `geode-ui` | `GEODE_METRICS_URL` | `http://geode:9090/metrics`        | Tells the proxy where to scrape. Empty disables `/api/v1/metrics` (the SPA hides the cards). |

The `deploy/docker-compose.test.yml` stack already wires both for the
Playwright suite — see `37-dashboard-metrics.spec.ts`.

### What each card shows

| Card | Source families | Notes |
|---|---|---|
| Query throughput | `geode_queries_total` (per-second derivative for the sparkline), `geode_queries_failed_total`, `geode_query_duration_seconds` (histogram, p95 via linear interpolation) | The "p95 latency" badge degrades to "—" when the histogram has fewer than two non-empty buckets. |
| Connections | `geode_connections_active` (live gauge), `geode_connections_total` | Sparkline shows the last 5 minutes of `active`. |
| Storage | `geode_nodes_total`, `geode_edges_total`, `geode_memory_bytes` | Memory is humanised (KB / MB / GB / TB). |
| Server | `geode_server_uptime`, `geode_server_health{component=server}`, `geode_transactions_total` | Health pill flips red when `healthy != 1`. |

### Troubleshooting

| Symptom | Probable cause | Fix |
|---|---|---|
| Cards do not render | `GEODE_METRICS_URL` is empty on the `geode-ui` server. | Set the env var and restart. |
| 503 `METRICS_DISABLED` in browser devtools | Same as above — explicit "feature off" signal. | As above. |
| 502 `METRICS_UPSTREAM` | `geode-ui` can reach the URL but the upstream is down or non-200. | Verify `geode` is running with `GEODE_METRICS_PORT` set; `curl http://geode:9090/metrics` from inside the geode-ui container. |
| 502 `METRICS_PARSE_ERROR` | An upstream geode update broke the prom-text shape. | Capture a fresh `/metrics` sample, compare against `internal/server/testdata/prom-geode-sample.txt`, file an upstream issue. |
| Cards render with `—` everywhere | Polling hook hasn't received a sample yet, OR the upstream returned 200 but with no `geode_*` families (geode build was compiled without the monitoring module). | Wait 5s for the next poll; if persistent, run `geode --version` and confirm v0.5.19+. |
