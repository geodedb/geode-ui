# ADR 0002: Profile-Store DEK Trust Model

## Status

Accepted

## Context

`geode-ui` persists database connection profiles in an embedded SQLite
file at `/var/lib/geode-ui/profiles.db`. Each profile carries the
operator's database credentials (the `dsn` column) and any client TLS
material (`tls_ca_pem`, `tls_cert_pem`, `tls_key_pem`). The first three
of those columns are unambiguously sensitive: leaking them gives an
attacker direct database access without traversing the application
auth boundary. The TLS key column is similarly load-bearing.

Three trust models are commonly applied to data of this sensitivity:

1. **No at-rest encryption.** File system permissions (`0600`,
   owner-only) are the only barrier. Operationally simple; assumes the
   host fs is trusted to the same degree as the secret material.
2. **Single-tier env-keyed DEK.** A single data encryption key (DEK)
   is supplied to the process at startup via an environment variable
   (or a Kubernetes secret mount, etc.). Sensitive columns are sealed
   under that key; loss of the key permanently locks the rows out of
   decryption. Operator-owned secret material rotates by running a
   one-shot sweep that re-seals every row under the new key. No
   separate key encryption key (KEK), no HSM, no derivation hierarchy.
3. **KEK → DEK derivation with external root of trust.** A root key
   in an HSM (or KMS service) decrypts a per-database DEK, which in
   turn decrypts the rows. Rotation can re-wrap the DEK without
   touching the underlying rows. Common in multi-tenant or
   compliance-heavy environments.

This ADR records the explicit choice of model 2.

## Decision

We use a **single-tier env-keyed DEK**:

- The DEK is a 32-byte AES-256 key supplied to the process at startup
  via the environment variable `GEODE_PROFILESTORE_KEY` (base64).
  Implementation: [`internal/profilestore/crypto.go:43-93`][crypto-env].
- Sensitive columns (`dsn`, `tls_ca_pem`, `tls_cert_pem`,
  `tls_key_pem`) are sealed with AES-256-GCM using the DEK directly;
  there is no KEK in the cryptosystem. Wire format:
  `[sentinel:0x01][nonce:12B][ciphertext+tag:variable]`.
- Other columns (`name`, `description`, `owner_user_id`, `scope`,
  `saved_username`, timestamps, pool overrides) are NOT encrypted.
  They have lower individual sensitivity and need to remain queryable
  for the UNIQUE `(scope, owner_user_id, name)` constraint and the
  scope/owner filters on `List`.
- Key rotation is a one-shot sweep via the `-profilestore-rewrap-from
  <hex>` startup flag: every row is decrypted under the prior key,
  re-sealed under the new key, and written back inside a single
  transaction. Implementation:
  [`internal/profilestore/sqlite_rewrap.go::RewrapSensitiveColumns`].
- Legacy plaintext rows (pre-encryption, before the SEC-S5 rollout)
  are detected by the leading-byte sentinel: any first byte other
  than `0x01` is treated as plaintext on read. The next `Patch`
  through such a row re-seals it under the active key. Sentinel
  rationale: PEM material always starts with `-` (0x2D); valid DSN
  schemes always start with a printable ASCII byte in `[0x20, 0x7E]`;
  `0x01` never collides.

## Trust assumption

The operator owns the secret material AND the filesystem on which
the SQLite file lives. Specifically:

- The host is trusted to keep `GEODE_PROFILESTORE_KEY` confidential
  (env var, /run/secrets mount, vault sidecar, etc.). The process
  reads the var, base64-decodes it, and discards the encoded form;
  the raw key is held in the `Cipher` value's `cipher.AEAD` for the
  lifetime of the process.
- The host is trusted to enforce `0600`/owner-only permissions on
  `/var/lib/geode-ui/profiles.db`. A reader with raw filesystem
  access to the SQLite file STILL cannot exfiltrate sensitive columns
  without the DEK — but the metadata columns (profile names,
  owner_user_id, timestamps) are visible.
- A compromise of the running process (memory read) yields the DEK
  along with whatever in-memory state existed at the time. This is
  the residual risk that the KEK → DEK model in option 3 above
  defends against (HSM-backed root means a memory dump alone is not
  enough to decrypt the on-disk rows after process restart).

## When this would need to change

The current model is intentionally simple. The following requirements
would force a move to the KEK → DEK model:

1. **Multi-tenant deployments.** When more than one tenant's profiles
   live in the same SQLite file (or when a single tenant's blast radius
   on key compromise needs to be capped), a per-tenant DEK derived
   from a tenant-scoped KEK becomes load-bearing.
2. **HSM / KMS integration requirement.** Compliance regimes (e.g.
   PCI-DSS at a strict interpretation, FedRAMP High) require that
   the root of trust never lives in unprotected process memory. An
   HSM-backed KEK that derives a per-process DEK on each boot
   satisfies that.
3. **Federated key management.** A central key manager (Vault Transit,
   AWS KMS, GCP CMEK, etc.) owns the KEK and rotates it on a regime
   external to this process. The KEK → DEK split is what makes that
   external rotation possible without re-sealing every row.

None of these requirements apply to the current deployment model
(`geode-ui` ships as a single-tenant administration interface for a
specific Geode instance). When they DO apply, the migration shape is:

- Introduce a `Cipher` factory that returns a per-row DEK derived
  from the wrapped DEK + a row-scoped salt.
- Persist a wrapped-DEK alongside the sealed columns (one extra
  column, or a per-tenant `dek_id` lookup table).
- Rotation becomes a re-wrap of the wrapped DEK only; rows do not
  move. The existing `-profilestore-rewrap-from` flag is retained as
  the bulk migration path for tenants migrating between models.

## Consequences

- Operator MUST treat `GEODE_PROFILESTORE_KEY` as a load-bearing
  secret. Loss is irrecoverable: every encrypted row is unreadable
  and must be re-entered. The startup error path on missing key is
  fail-loud, with a generator hint
  (`openssl rand -base64 32`).
- A single key compromise leaks every encrypted row in the file. The
  blast radius matches the scope of the single deployment (one Geode
  instance, one administration database).
- Rotation is offline: the operator stops the process, re-runs with
  `-profilestore-rewrap-from <old-base64>` set and the NEW key in
  `GEODE_PROFILESTORE_KEY`, the sweep re-seals every row, the process
  resumes serving traffic. Implementation has been integration-tested
  via `internal/profilestore/sqlite_rewrap_test.go`.
- No HSM round-trip on the hot path: every read is a cheap AES-GCM
  decrypt with an in-process AEAD. Profile reads under load are not
  bottlenecked on an external service.

## References

- Code:
  - [`internal/profilestore/crypto.go:25-31, 57-93`][crypto-env] —
    sentinel + wire format + env-key constructor.
  - [`internal/profilestore/sqlite.go`] — Open/Close/handle
    accessors + `sealString` / `unsealBytes` seam.
  - [`internal/profilestore/sqlite_rewrap.go`] — rotation sweep.
- Related ADRs:
  - [ADR 0001: Generated API Boundary](0001-generated-api-boundary.md).
- Related gap entries:
  - GAP-S5 — original sealing rollout.
  - SEC-NEW-8 (#211) — re-wrap sweep design.
  - F-INPUT-2 (#143) — fail-loud when ciphertext is present but no
    cipher is configured.
  - S-2026-05-17-10 (#274) — this ADR.

[crypto-env]: ../../internal/profilestore/crypto.go
