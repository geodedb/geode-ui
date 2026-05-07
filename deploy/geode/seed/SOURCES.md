# Seed dataset sources

The integration test stack uses the **Neo4j Movies** dataset — a small,
canonical, multi-relationship graph that has become the de-facto demo
dataset across graph databases (Neo4j, Memgraph, ArangoDB, AWS Neptune
all ship a variant of it).

## Why this dataset

| Requirement | Neo4j Movies | isabeldepapel/moviegraph (rejected) |
|---|---|---|
| Curated graph data, not an app | Yes — single Cypher script | No — Django webapp that *consumes* movie data |
| Multiple relationship types | 6 (`ACTED_IN`, `DIRECTED`, `PRODUCED`, `WROTE`, `REVIEWED`, `FOLLOWS`) | N/A |
| Property-rich nodes/edges | `released`, `tagline`, `born`, `roles`, `summary`, `rating` | N/A |
| Deterministic + reproducible | Yes (~656-line Cypher script) | No (depends on a live IMDB scrape) |
| Maintained | neo4j-graph-examples org, current | 1 star, last commit 2022 |
| License | Apache 2.0 | MIT |

The user-suggested `isabeldepapel/moviegraph` is a 2022 Django project for
a movie recommendation system; it doesn't ship a portable seed dataset
and depends on an external scrape pipeline. Not appropriate for a
hermetic Docker-compose integration suite.

## Source

- **Upstream:** <https://github.com/neo4j-graph-examples/movies>
- **Specific file:** `scripts/movies.cypher` on `main`
- **License:** Apache 2.0 (see upstream `LICENSE`)

The unmodified upstream Cypher is preserved in `movies.cypher` (this
directory) so we can rebuild the converted GQL deterministically when
upstream updates land.

## Geode dialect quirks the converter handles

Neo4j Cypher and Geode v0.5.11's GQL dialect differ in three ways the
seed must work around:

1. **No `MERGE`.** Geode supports `CREATE` only. The converter dedupes
   nodes by `(label, primary-key)` so each unique node is created
   exactly once, and rewrites relationship `MERGE` to a
   `MATCH ... CREATE` pattern.
2. **No `CREATE CONSTRAINT`.** Geode v0.5.11's wire dialect rejects
   constraint DDL with a `42000` parse error. The converter drops
   constraint statements entirely; uniqueness is achieved by the
   dedup pass instead.
3. **Array properties round-trip as opaque binary.** A literal
   `roles: ['Neo']` parses but storage emits a base64-encoded blob
   on read. The converter flattens arrays to a pipe-separated
   string (`roles: 'Neo'`, `roles: 'Smith|Anderson'`) so the value
   stays human-readable in result tables and can still be split by
   queries when needed.

## Regenerating the seed

```sh
cd deploy/geode/seed
python3 convert.py movies.cypher > ../init.gql
```

The output is committed to source control so the docker build doesn't
need Python at image-build time. Re-run only when:

- Upstream `movies.cypher` changes and we want to absorb the update.
- A new Geode dialect quirk forces a converter change.

The deterministic ordering in the converter (sorted node tuples, sorted
relationship tuples) means the same input yields byte-identical output
across runs — diff-friendly review of upstream updates.
