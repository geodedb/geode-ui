# Security Administration

The `/admin` section exposes Geode's policy primitives. This document
covers the surfaces added in Geode 0.5.20.

## User Attributes

Each user can hold arbitrary key/value attributes (department, region,
level, …) that ABAC row-level policies consume at query time.
Attributes are managed via the **Attributes** button on each row of
`/admin/users` — the per-user editor lets you add and remove
key/value pairs.

Keys must match the GQL identifier shape `[A-Za-z_][A-Za-z0-9_]*`.
The UI validates this client-side before issuing the wire call.

Backend procedures the UI calls:

- `geode.auth.user_set_attribute(username, key, value)`
- `geode.auth.user_remove_attribute(username, key)`
- `geode.auth.user_list_attributes(username)` *(optional; the UI
  falls back to an in-session mirror when this procedure is
  unimplemented)*

## RLS Deny Policies (`/admin/rls-deny`)

Label-level deny: rows of `<label>` in `<graph>` are hidden from
`<username>`. Leaving the username empty applies the deny to all
users.

Backend procedures:

- `geode.rls.add_deny_policy(graph, label, username)`
- `geode.rls.remove_deny_policy(graph, label, username)`
- `geode.rls.list_deny_policies()`
- `geode.rls.policy_count()`

## RLS Attribute Policies (`/admin/rls-attribute`)

For each row of `<label>` in `<graph>`, the row is visible only when
`row.<rowProperty>` equals the requesting principal's
`attribute.<attributeKey>`. Combine with User Attributes to drive
per-tenant or per-department row visibility.

Backend procedures:

- `geode.rls.add_attribute_policy(graph, label, row_property, attribute_key)`
- `geode.rls.remove_attribute_policy(graph, label, row_property, attribute_key)`

Listing is provided indirectly via `gps.list_policies()`, filtered
to restrictive `select` policies whose expression matches the
canonical `row.X = principal.attribute.Y` shape. On builds without
`gps.list_policies` the UI maintains an in-session mirror so
policies created during the current session remain visible.

## Capabilities gating

`GET /api/v1/capabilities` reports `admin_writable.{attributes,
rls_deny_policies, rls_attribute_policies}` so the UI can disable
the affected tab/action on pre-0.5.20 builds (the disabled state
carries a tooltip pointing at the version requirement).
