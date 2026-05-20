# Policies (row-level RBAC)

> **Status: upstream-deferred.** CREATE POLICY is not yet implemented
> in upstream Geode (v0.5.19). The SPA capability gate
> (`admin_writable.policies`) reports `false` and the Admin shell
> renders the Policies tab as disabled. See GAP-050 for the gate
> implementation and GAP-003 / GAP_AUTH_DDL.md Limitations #3 for the
> upstream tracking.

## Intended syntax

```gql
CREATE POLICY policy_name
  ON GRAPH graph_name
  FOR { SELECT | MATCH | UPDATE | DELETE }
  TO role_name
  WITH FILTER 'WHERE n.tenant_id = $current_tenant'
```gql

## Intended capability

`/api/v1/capabilities` → `admin_writable.policies = true` when the
upstream feature ships.

## Until then

Use [GRANT](./auth-ddl.md#grant) to scope at the role level. Combine
with application-side query rewriting if a row-level guard is needed
before the wire op lands.
