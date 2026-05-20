# Geode GQL+ Core

> **Scope:** core ISO-GQL clauses Geode v0.5.19 supports for read +
> write workloads. Subset-specific pages live alongside this file:
> [auth-ddl](./auth-ddl.md), [policies](./policies.md),
> [migrations](./migrations.md).

## MATCH

The pattern-matching clause. Walk a graph by labelled nodes and typed
edges; bind nodes and relationships to identifiers used downstream.

### Syntax

```gql
MATCH (n:Label)
MATCH (n:Label)-[r:REL]->(m:Other)
MATCH path = (n:Label)-[*1..3]->(m)
```

### Examples

```gql
MATCH (p:Person)
WHERE p.name = $name
RETURN p
```

```gql
MATCH (p:Person)-[a:ACTED_IN]->(m:Movie)
RETURN p.name, m.title, a.roles
LIMIT 25
```

### Capability

Always available. No `/api/v1/capabilities` gate.

### Errors

- `42000` — syntax error (malformed pattern, bare identifiers in a
  position that requires a label).
- `08006` — connection lost mid-query.

---

## RETURN

Project columns from the bindings introduced by `MATCH` / `CREATE` /
`WITH`. Drives the column ordering of the result table.

### Syntax

```gql
RETURN n
RETURN n.name AS name
RETURN n.name AS name, count(*) AS hits
```

---

## WHERE

Boolean filter applied to the rows produced upstream of `WHERE` in the
clause chain. Supports `AND` / `OR` / `NOT`, equality, range, IS NULL,
list / map index access, and parameterised lookups (`$name`).

### Examples

```gql
MATCH (p:Person)
WHERE p.born >= 1970 AND p.born < 1990
RETURN p
```

---

## CREATE

Materialise a pattern. New nodes and relationships are inserted; existing
matches in the pattern are reused.

```gql
CREATE (m:Movie {title: 'The Matrix', released: 1999})
```

---

## WITH

Pipe rows between clause stages. Use it to introduce intermediate
aggregations, drop bindings, or re-`MATCH` on a refined row set.

```gql
MATCH (p:Person)
WITH p, count{(p)-[:ACTED_IN]->()} AS movies
WHERE movies > 5
RETURN p.name, movies
```

---

## LIMIT / SKIP

Pagination primitives. `SKIP` runs first, `LIMIT` second.

```gql
MATCH (m:Movie)
RETURN m.title
ORDER BY m.released DESC
SKIP 10
LIMIT 10
```

---

## ORDER BY

Sort the row set. Multiple columns + `ASC` / `DESC` per column.

```gql
RETURN m.title, m.released
ORDER BY m.released DESC, m.title ASC
```

---

## USE GRAPH

Geode-specific extension that scopes the rest of the statement to a
named graph. Required in multi-graph deployments where the default
context is ambiguous.

```gql
USE GRAPH movies;
MATCH (m:Movie) RETURN m LIMIT 5
```

---

## See also

- [auth-ddl](./auth-ddl.md) — user / role / grant DDL.
- [policies](./policies.md) — row-level / property-level RBAC.
- [migrations](./migrations.md) — schema-evolution workflow.
