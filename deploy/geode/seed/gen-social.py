#!/usr/bin/env python3
"""Generate a synthetic social-graph seed (deploy/geode/social.gql).

Produces ~10,000 :Person nodes and ~50,000 :Person-[:FOLLOWS]->:Person
edges drawn from a fixed PRNG seed so successive runs are byte-stable.
The output is consumed by deploy/geode/seed-bootstrap.sh against the
secondary `geode-b` upstream in the e2e compose stack.

Geode dialect quirks the file works around (mirrored from convert.py
and convert-vulndb.py for the existing movies + vulndb seeds):

  - `USE GRAPH <name>;` does NOT persist across statements; every
    statement starts with `USE GRAPH social;`.
  - `CREATE GRAPH social` only fires once at the top.
  - Nodes batched 100-per-CREATE so we get ~100 statements for 10k
    nodes instead of 10k individual CREATEs.
  - Edges remain one MATCH+CREATE per statement because every edge
    has a distinct endpoint pair and inlining many MATCHes per
    statement isn't supported by the v0.5.19 dialect.
  - Single quotes inside property strings are doubled per the SQL
    literal escape rule the wire parser uses.

Output schema:

    (:Person {id: int, name: text, age: int, city: text})
    (:Person)-[:FOLLOWS {since: int}]->(:Person)

Run from repo root:

    python3 deploy/geode/seed/gen-social.py \\
        --nodes 10000 --edges 50000 \\
        --out deploy/geode/social.gql

Counts smaller than the defaults are useful for ad-hoc smoke tests;
keep the production numbers in lockstep with the GEODE_SEEDS env in
the compose stack so the seed-bootstrap idempotency check passes.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

DEFAULT_NODES = 10_000
DEFAULT_EDGES = 50_000
PRNG_SEED = 0x5EED_50C1A1  # 0x"SEED SOCIAL"

# Deterministic dictionaries — kept small so the file is reviewable.
FIRST_NAMES = [
    "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi",
    "Ivan", "Judy", "Karl", "Liam", "Mia", "Niamh", "Oscar", "Peggy",
    "Quinn", "Ruth", "Sergey", "Trent", "Uma", "Victor", "Wendy",
    "Xena", "Yara", "Zane", "Avery", "Blake", "Casey", "Drew", "Emery",
    "Finley", "Gray", "Harper", "Indigo", "Jordan", "Kai", "Logan",
    "Morgan", "Nico", "Owen", "Parker", "Quincy", "River", "Sage",
    "Taylor", "Umber", "Vale", "Wren", "Xan", "Yael", "Zephyr",
]

LAST_NAMES = [
    "Adams", "Brown", "Carter", "Davis", "Evans", "Foster", "Garcia",
    "Hill", "Ingram", "Jones", "Khan", "Lee", "Martinez", "Nguyen",
    "Owens", "Patel", "Quinn", "Rivera", "Smith", "Taylor", "Uribe",
    "Vargas", "Williams", "Xu", "Young", "Zimmerman", "Allen", "Baker",
    "Clark", "Diaz", "Edwards", "Fischer", "Greene", "Holt", "Iverson",
    "Jensen", "King", "Lopez", "Mitchell", "Nelson", "Ortiz", "Park",
    "Reyes", "Stevens", "Tran", "Underwood", "Vega", "Walker", "Yates",
]

CITIES = [
    "New York", "San Francisco", "Austin", "Seattle", "Boston",
    "Chicago", "Denver", "Portland", "Atlanta", "Miami", "Toronto",
    "Vancouver", "London", "Berlin", "Amsterdam", "Paris", "Stockholm",
    "Oslo", "Helsinki", "Copenhagen", "Dublin", "Lisbon", "Madrid",
    "Barcelona", "Tokyo", "Osaka", "Singapore", "Sydney", "Melbourne",
    "Auckland", "Sao Paulo", "Buenos Aires", "Mexico City", "Bangalore",
    "Mumbai", "Tel Aviv", "Cape Town",
]


def esc(s: str) -> str:
    """Escape a single-quoted GQL string literal."""
    return s.replace("'", "''")


def make_node_line(rng: random.Random, node_id: int) -> str:
    """Single-node CREATE — one statement per node.

    Earlier revisions batched 100 nodes per CREATE to keep the file
    line count down, but Geode v0.5.18's `geode query -f` re-executes
    the last statement of each ~100-statement batch (observed ~31
    batch boundaries on a 50k-line file). One node per statement
    means each batch-boundary duplicate adds at most ONE extra
    :Person node, which the seed-bootstrap dedupe_graph_label step
    then collapses to the unique-id contract. String IDs (e.g.
    'p42') line up with that helper's `n.id = '<xid>'` quoting.
    """
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES)
    age = rng.randint(18, 79)
    city = rng.choice(CITIES)
    return (
        f"USE GRAPH social; CREATE (:Person {{id: 'p{node_id}', "
        f"name: '{esc(first + ' ' + last)}', "
        f"age: {age}, "
        f"city: '{esc(city)}'}});\n"
    )


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--nodes", type=int, default=DEFAULT_NODES)
    p.add_argument("--edges", type=int, default=DEFAULT_EDGES)
    p.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "social.gql",
    )
    args = p.parse_args(argv)

    if args.nodes < 1 or args.edges < 0:
        print("--nodes >= 1 and --edges >= 0 required", file=sys.stderr)
        return 2

    rng = random.Random(PRNG_SEED)

    with args.out.open("w") as f:
        f.write(
            "/*\n"
            " * Generated by deploy/geode/seed/gen-social.py — DO NOT EDIT.\n"
            " *\n"
            f" * {args.nodes} :Person nodes + {args.edges} (:Person)-[:FOLLOWS]->(:Person) edges.\n"
            " * Deterministic from PRNG seed 0x5EED50C1A1.\n"
            " */\n\n"
        )
        f.write("CREATE GRAPH social;\n\n")
        f.write("/* Nodes: one CREATE per statement (see make_node_line). */\n")

        # Emit one node per statement.
        for node_id in range(1, args.nodes + 1):
            f.write(make_node_line(rng, node_id))

        f.write("\n/* Edges: one MATCH+CREATE per statement. */\n")

        # Generate edges. Sample without replacement on (src, dst) pairs
        # so we don't create accidental multi-edges, but cap retries so
        # the loop always terminates even on pathological RNG state.
        seen: set[tuple[int, int]] = set()
        attempts = 0
        max_attempts = args.edges * 8
        emitted = 0
        while emitted < args.edges and attempts < max_attempts:
            attempts += 1
            src = rng.randint(1, args.nodes)
            dst = rng.randint(1, args.nodes)
            if src == dst:
                continue
            key = (src, dst)
            if key in seen:
                continue
            seen.add(key)
            since = rng.randint(2010, 2026)
            f.write(
                f"USE GRAPH social; "
                f"MATCH (a:Person {{id: 'p{src}'}}), (b:Person {{id: 'p{dst}'}}) "
                f"CREATE (a)-[:FOLLOWS {{since: {since}}}]->(b);\n"
            )
            emitted += 1

        if emitted < args.edges:
            print(
                f"warning: produced {emitted}/{args.edges} edges after "
                f"{attempts} attempts (graph may be too small for the "
                "requested edge count)",
                file=sys.stderr,
            )

    print(
        f"wrote {args.out}: {args.nodes} nodes + {emitted} edges",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
