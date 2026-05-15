#!/usr/bin/env python3
"""Convert the Neo4j Movies Cypher seed to Geode v0.5.11-compatible GQL.

Geode v0.5.11 differs from Neo4j Cypher in three relevant ways:

  1. No MERGE — only CREATE. We dedupe nodes by (label, primary-key)
     across the whole input and emit one CREATE per unique node, then
     create relationships via MATCH ... CREATE patterns.
  2. No CREATE CONSTRAINT — Geode rejects it as a 42000 parse error.
     Dropped on output. Uniqueness is enforced by our own dedup pass.
  3. Array properties round-trip as opaque binary blobs (the storage
     layer base64-encodes them). We flatten arrays to a pipe-separated
     string so the value remains human-readable in result tables and
     can be split by queries when needed.

Output is byte-deterministic: nodes are sorted by (label, primary-key)
and relationships by (start, type, end, sorted-props). That makes diffs
trivial to review when the upstream Cypher gets refreshed.

Usage:
    python3 convert.py movies.cypher [--graph movies] > init.gql

Stdin is also accepted. Argparse keeps the script self-documenting.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from typing import Optional


# Property parsing
# ----------------
# Cypher property maps look like:
#   {title:'The Matrix', released:1999, tagline:'Welcome'}
#   {roles:['Neo','Mr. Anderson'], rating:95, summary:"He's a hero"}
#   {summary:"Slapstick redeemed only by the Robin Williams and Gene Hackman's stellar performances", rating:45}
#
# String values are quoted with either ' or "; the latter is used when
# the value itself contains an apostrophe. Arrays are bracketed and
# contain string or numeric items.
#
# We tokenise by walking character-by-character so apostrophes/commas
# inside quoted strings don't confuse us — a regex-only approach miscounts
# the Bird-cage / Da Vinci Code review summaries.


def _split_top_level(s: str, sep: str) -> list[str]:
    """Split s on sep, ignoring sep inside quotes or square brackets."""
    parts: list[str] = []
    depth = 0
    quote: Optional[str] = None
    cur: list[str] = []
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            cur.append(ch)
            if ch == "\\" and i + 1 < len(s):
                cur.append(s[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            cur.append(ch)
        elif ch == "[":
            depth += 1
            cur.append(ch)
        elif ch == "]":
            depth -= 1
            cur.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    if cur:
        parts.append("".join(cur).strip())
    return parts


def _strip_quotes(s: str) -> str:
    """Strip the surrounding quote pair AND unescape Cypher backslash
    escapes inside the string. The upstream movies.cypher uses `\\'` to
    embed apostrophes inside single-quoted strings (e.g. "nation\\'s
    capital"). Without unescaping, the backslash leaks into our output
    and Geode either rejects the literal or stores the wrong value."""
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        s = s[1:-1]
    # Cypher string escapes we need to undo: \' \" \\ \n \t \r.
    return (
        s.replace("\\'", "'")
        .replace('\\"', '"')
        .replace("\\\\", "\\")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
    )


def _flatten_array(s: str) -> str:
    """Take a Cypher array literal like ['Neo','Mr. Anderson'] and return
    the pipe-joined string 'Neo|Mr. Anderson'. Keeps Geode property
    storage human-readable; arrays in v0.5.11 round-trip as binary."""
    inner = s.strip()
    assert inner.startswith("[") and inner.endswith("]"), inner
    items = _split_top_level(inner[1:-1], ",")
    return "|".join(_strip_quotes(it) for it in items if it)


def parse_props(blob: str) -> dict[str, object]:
    """Parse the body of a Cypher {a:b, c:d} block (without braces)."""
    out: dict[str, object] = {}
    for entry in _split_top_level(blob, ","):
        if not entry:
            continue
        # Split on the FIRST colon — values may contain colons inside
        # strings (e.g. URLs in summaries).
        idx = entry.index(":")
        key = entry[:idx].strip()
        raw = entry[idx + 1 :].strip()
        if raw.startswith("["):
            out[key] = _flatten_array(raw)
        elif raw.startswith("'") or raw.startswith('"'):
            out[key] = _strip_quotes(raw)
        else:
            # Numeric (int or float).
            try:
                if "." in raw:
                    out[key] = float(raw)
                else:
                    out[key] = int(raw)
            except ValueError:
                # Fallback: pass through verbatim. Should not happen in
                # the upstream movies.cypher — guard anyway.
                out[key] = raw
    return out


def emit_value(v: object) -> str:
    """Render a Python value as a Geode GQL property literal."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise TypeError(f"unhandled property value type: {type(v).__name__}")


def emit_props(props: dict[str, object]) -> str:
    if not props:
        return ""
    return (
        " {"
        + ", ".join(f"{k}: {emit_value(v)}" for k, v in sorted(props.items()))
        + "}"
    )


# Pattern matchers
# ----------------
# These regexes capture the alias, label, and the literal property block.
# We then hand the property block to parse_props for value-aware parsing.

NODE_RE = re.compile(
    r"^\s*MERGE\s*\(\s*(?P<alias>\w+)\s*:\s*(?P<label>\w+)\s*"
    r"\{(?P<keyprops>[^}]+)\}\s*\)\s*"
    r"(?:ON\s+CREATE\s+SET\s+(?P<setprops>.+?))?\s*;?\s*$",
    re.IGNORECASE | re.DOTALL,
)

MATCH_RE = re.compile(
    r"^\s*MATCH\s*\(\s*(?P<alias>\w+)\s*:\s*(?P<label>\w+)\s*"
    r"\{(?P<keyprops>[^}]+)\}\s*\)\s*;?\s*$",
    re.IGNORECASE | re.DOTALL,
)

REL_RE = re.compile(
    r"^\s*MERGE\s*\(\s*(?P<lhs>\w+)\s*\)\s*-\s*"
    r"\[\s*:(?P<type>\w+)\s*(?:\{(?P<props>[^}]+)\})?\s*\]\s*->\s*"
    r"\(\s*(?P<rhs>\w+)\s*\)\s*;?\s*$",
    re.IGNORECASE | re.DOTALL,
)

CONSTRAINT_RE = re.compile(r"^\s*CREATE\s+CONSTRAINT\b", re.IGNORECASE)


# Data model
# ----------

@dataclass(frozen=True)
class NodeKey:
    label: str
    pk_field: str  # the key field used to identify uniqueness, e.g. "title"
    pk_value: str


@dataclass
class Node:
    key: NodeKey
    props: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Rel:
    start: NodeKey
    type: str
    end: NodeKey
    # props are sorted-key tuples so the dataclass is hashable; we need
    # hashability so identical REVIEWED relationships dedupe (the upstream
    # data has none, but it's cheap defence-in-depth).
    props: tuple[tuple[str, object], ...] = ()


def parse_keyprops(label: str, blob: str) -> tuple[str, str]:
    """Return (pk_field, pk_value) for a node label. Convention: Movie
    is keyed on `title`, everyone else on `name`. The upstream Cypher
    guarantees uniqueness on those fields."""
    props = parse_props(blob)
    for candidate in ("title", "name"):
        if candidate in props:
            return candidate, str(props[candidate])
    # Fallback: use the first key alphabetically. Should not happen with
    # the upstream movies dataset.
    first = sorted(props.keys())[0]
    return first, str(props[first])


def parse_setprops(alias: str, blob: str) -> dict[str, object]:
    """Parse `alias.prop=value, alias.prop=value, ...` ON CREATE SET clauses."""
    out: dict[str, object] = {}
    for entry in _split_top_level(blob, ","):
        entry = entry.strip().rstrip(";").strip()
        if not entry:
            continue
        # Strip the "alias." prefix.
        if entry.startswith(alias + "."):
            entry = entry[len(alias) + 1 :]
        idx = entry.index("=")
        key = entry[:idx].strip()
        raw = entry[idx + 1 :].strip()
        # Reuse parse_props by re-wrapping: easier than duplicating the
        # value parser.
        merged = parse_props(f"{key}: {raw}")
        out.update(merged)
    return out


def parse_cypher(text: str) -> tuple[dict[NodeKey, Node], list[Rel]]:
    """Walk the Cypher source and produce a deduped node table + rel list."""
    nodes: dict[NodeKey, Node] = {}
    rels: list[Rel] = []
    aliases: dict[str, NodeKey] = {}

    # Statements are `;`-terminated. Some MERGE blocks span multiple
    # lines (a node, a couple of rels, then `;`). Split on `;` AND on
    # blank lines so an alias scope ends when either boundary appears.
    text = text.replace("\r", "")
    blocks = re.split(r";\s*\n", text)

    for block in blocks:
        # Within a block, statements are separated by newlines. Aliases
        # established by MATCH or MERGE in the block stay valid for
        # subsequent MERGE rel lines in the same block.
        local_aliases: dict[str, NodeKey] = {}
        for raw_line in block.split("\n"):
            line = raw_line.strip()
            if not line or line.startswith("//"):
                continue
            if CONSTRAINT_RE.match(line):
                continue

            m = NODE_RE.match(line)
            if m:
                alias = m.group("alias")
                label = m.group("label")
                pk_field, pk_value = parse_keyprops(label, m.group("keyprops"))
                key = NodeKey(label=label, pk_field=pk_field, pk_value=pk_value)
                node = nodes.setdefault(key, Node(key=key))
                # Always carry the keyprops into props so single-statement
                # nodes still get their identifying property.
                node.props.update(parse_props(m.group("keyprops")))
                if m.group("setprops"):
                    node.props.update(parse_setprops(alias, m.group("setprops")))
                local_aliases[alias] = key
                aliases[alias] = key
                continue

            m = MATCH_RE.match(line)
            if m:
                alias = m.group("alias")
                label = m.group("label")
                pk_field, pk_value = parse_keyprops(label, m.group("keyprops"))
                key = NodeKey(label=label, pk_field=pk_field, pk_value=pk_value)
                local_aliases[alias] = key
                aliases[alias] = key
                continue

            m = REL_RE.match(line)
            if m:
                lhs_alias = m.group("lhs")
                rhs_alias = m.group("rhs")
                # Resolve via local first, fall back to global.
                lhs = local_aliases.get(lhs_alias) or aliases.get(lhs_alias)
                rhs = local_aliases.get(rhs_alias) or aliases.get(rhs_alias)
                if lhs is None or rhs is None:
                    print(
                        f"WARN: unresolved alias on rel line: {line!r}",
                        file=sys.stderr,
                    )
                    continue
                props = (
                    parse_props(m.group("props")) if m.group("props") else {}
                )
                rel = Rel(
                    start=lhs,
                    type=m.group("type"),
                    end=rhs,
                    props=tuple(sorted(props.items())),
                )
                rels.append(rel)
                continue

            # Anything else (bare CREATE, blank, etc.) is dropped silently.

    return nodes, rels


def emit_gql(nodes: dict[NodeKey, Node], rels: list[Rel], graph: str) -> str:
    """Serialise the parsed graph as Geode-compatible GQL statements."""
    out: list[str] = []
    out.append("/*")
    out.append(" * Generated from deploy/geode/seed/movies.cypher by")
    out.append(" * deploy/geode/seed/convert.py — DO NOT EDIT BY HAND.")
    out.append(" *")
    out.append(" * Source: Neo4j Movies dataset")
    out.append(" * <https://github.com/neo4j-graph-examples/movies>")
    out.append(" * License: Apache 2.0")
    out.append(" *")
    out.append(" * Geode v0.5.11 dialect quirks the converter handles:")
    out.append(" *   - Cypher MERGE → CREATE (with cross-statement dedup).")
    out.append(" *   - CREATE CONSTRAINT dropped (42000 parse error on wire).")
    out.append(" *   - Array properties flattened to pipe-separated strings.")
    out.append(" */")
    out.append("")
    out.append(f"CREATE GRAPH {graph};")
    out.append("")

    # Nodes — sorted for byte-deterministic output.
    out.append(f"/* Nodes ({len(nodes)} total) */")
    sorted_keys = sorted(nodes.keys(), key=lambda k: (k.label, k.pk_value))
    for key in sorted_keys:
        node = nodes[key]
        out.append(
            f"USE GRAPH {graph}; CREATE (:{key.label}{emit_props(node.props)});"
        )
    out.append("")

    # Group rels by type for readability and emit each in deterministic order.
    out.append(f"/* Relationships ({len(rels)} total) */")
    # See the sentinel `RETURN 1` at the very end — Geode v0.5.11's
    # `geode query -f <file>` re-executes the LAST data-mutation statement
    # in the file (observed: a single `MATCH ... CREATE` at end-of-file
    # produces TWO edges). Emitting a side-effect-free trailing statement
    # absorbs the double-execution so all real data lines run exactly
    # once.
    by_type: dict[str, list[Rel]] = {}
    for r in rels:
        by_type.setdefault(r.type, []).append(r)
    for rtype in sorted(by_type.keys()):
        bucket = by_type[rtype]
        bucket.sort(
            key=lambda r: (
                r.start.label,
                r.start.pk_value,
                r.end.label,
                r.end.pk_value,
                r.props,
            )
        )
        out.append(f"/* {rtype} ({len(bucket)}) */")
        for r in bucket:
            props = dict(r.props)
            propblock = emit_props(props)
            # Bind both endpoints by their (label, pk_field=pk_value)
            # so MATCH lands the exact node, even when names collide
            # with relationship aliases (the upstream Cypher reuses the
            # name "JoelS" etc., which is fine here because we re-resolve
            # via primary key rather than alias).
            start_clause = (
                f"(s:{r.start.label} "
                f"{{{r.start.pk_field}: {emit_value(r.start.pk_value)}}})"
            )
            end_clause = (
                f"(e:{r.end.label} "
                f"{{{r.end.pk_field}: {emit_value(r.end.pk_value)}}})"
            )
            out.append(
                f"USE GRAPH {graph}; MATCH {start_clause}, {end_clause} "
                f"CREATE (s)-[:{rtype}{propblock}]->(e);"
            )
        out.append("")

    # Sentinels: Geode v0.5.11's `geode query -f <file>` re-executes the
    # last data-mutation statement, even if a non-mutation (RETURN 1)
    # follows it. We work around that by:
    #   1. Closing the relationship list with a CREATE/DELETE pair on a
    #      dedicated `__seed_sentinel` node — that statement is the one
    #      that gets doubled, but it touches only its own throwaway
    #      label so real data is unaffected.
    #   2. Following with a no-op RETURN so the human-readable file
    #      ends on a recognisable, side-effect-free statement.
    out.append("/* Sentinels — see comment in convert.py emit_gql(). */")
    out.append(
        f"USE GRAPH {graph}; CREATE (:__seed_sentinel {{tag: 'absorb-double-exec'}});"
    )
    out.append(
        f"USE GRAPH {graph}; MATCH (s:__seed_sentinel) DETACH DELETE s;"
    )
    out.append(f"USE GRAPH {graph}; RETURN 1;")

    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument(
        "input",
        nargs="?",
        default="-",
        help="Cypher source file, or '-' for stdin (default: stdin).",
    )
    ap.add_argument(
        "--graph",
        default="movies",
        help="Geode graph name to USE (default: movies).",
    )
    args = ap.parse_args(argv)

    if args.input == "-":
        text = sys.stdin.read()
    else:
        with open(args.input, encoding="utf-8") as f:
            text = f.read()

    nodes, rels = parse_cypher(text)
    sys.stdout.write(emit_gql(nodes, rels, args.graph))
    print(
        f"// emitted {len(nodes)} nodes, {len(rels)} relationships",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
