#!/usr/bin/env python3
"""Convert ~/vulndb jsonl files to a Geode v0.5.11-compatible GQL seed.

Loads two compact subsets of the vulnerability database into a single
`vulndb` graph for use as a richer test fixture for geode-ui:

  * CWE nodes — full CWE catalog (~969 entries) from cwe.jsonl
  * CVE nodes — first KEV_LIMIT entries from kevc.jsonl (sampled to
    keep the graph small enough for visual rendering tests)
  * Package nodes — deduplicated (name, ecosystem) from the same KEV
    sample
  * AFFECTS edges — each CVE to each affected Package

The output exercises multiple node labels, an edge type with no edge
properties, multiple distinct property keys per label, and is small
enough (~few thousand nodes/edges) to render in a single graph view
session without virtualisation tricks.

Usage:
  python3 deploy/geode/seed/convert-vulndb.py \\
      --cwe ~/vulndb/cwe.jsonl \\
      --kev ~/vulndb/kevc.jsonl \\
      --output deploy/geode/vulndb.gql
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

KEV_LIMIT = 250  # Sample size — keeps the seed file under ~1MB.


def gql_str(value: object) -> str:
    """Render a Python value as a GQL string literal.

    Geode v0.5.11's string-literal grammar tolerates a single-quote
    escape (doubled '') but rejects raw control characters — embedded
    newlines or tabs in the source value silently terminate the
    statement and corrupt the rest of the seed file. We collapse all
    whitespace to single spaces and strip ASCII control characters
    other than space before doubling quotes.
    """
    s = "" if value is None else str(value)
    # Normalise CR/LF/tab + any other control char (incl. NUL) to a
    # single space, then collapse runs of whitespace.
    cleaned = []
    for ch in s:
        code = ord(ch)
        if code < 0x20 or code == 0x7F:
            cleaned.append(" ")
        else:
            cleaned.append(ch)
    s = "".join(cleaned)
    while "  " in s:
        s = s.replace("  ", " ")
    s = s.strip()
    return "'" + s.replace("'", "''") + "'"


def gql_props(props: dict[str, object]) -> str:
    parts = []
    for k in sorted(props):
        v = props[k]
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            parts.append(f"{k}: {str(v).lower()}")
        elif isinstance(v, (int, float)):
            parts.append(f"{k}: {v}")
        else:
            parts.append(f"{k}: {gql_str(v)}")
    return "{" + ", ".join(parts) + "}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cwe", required=True, type=Path)
    p.add_argument("--kev", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument(
        "--kev-limit",
        type=int,
        default=KEV_LIMIT,
        help=f"how many KEV CVEs to include (default {KEV_LIMIT})",
    )
    args = p.parse_args()

    cwe_path = args.cwe.expanduser()
    kev_path = args.kev.expanduser()
    out_path = args.output

    if not cwe_path.exists():
        print(f"missing {cwe_path}", file=sys.stderr)
        return 1
    if not kev_path.exists():
        print(f"missing {kev_path}", file=sys.stderr)
        return 1

    lines: list[str] = []
    lines.append("/*")
    lines.append(" * Generated from ~/vulndb by deploy/geode/seed/convert-vulndb.py")
    lines.append(" * — DO NOT EDIT BY HAND.")
    lines.append(" *")
    lines.append(" * Sources:")
    lines.append(" *   * cwe.jsonl    — full CWE catalog")
    lines.append(f" *   * kevc.jsonl   — first {args.kev_limit} entries")
    lines.append(" *")
    lines.append(" * Geode v0.5.11 dialect quirks the converter handles:")
    lines.append(" *   - Cypher MERGE → CREATE (with cross-statement dedup).")
    lines.append(" *   - CREATE CONSTRAINT dropped (42000 parse error on wire).")
    lines.append(" *   - Array properties flattened to pipe-separated strings.")
    lines.append(" */")
    lines.append("")
    lines.append("CREATE GRAPH vulndb;")
    lines.append("")

    # ----- CWE nodes -----
    lines.append("/* CWE nodes (full catalog) */")
    cwe_count = 0
    with cwe_path.open(encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            row = json.loads(raw)
            props = {
                "id": row.get("id"),
                "name": row.get("name"),
                "description": row.get("description"),
                "status": row.get("status"),
            }
            lines.append(f"USE GRAPH vulndb; CREATE (:CWE {gql_props(props)});")
            cwe_count += 1
    lines.append("")

    # ----- KEV CVE + Package nodes -----
    lines.append(f"/* CVE nodes (first {args.kev_limit} from KEV) */")
    cve_records: list[dict[str, object]] = []
    package_map: dict[tuple[str, str], dict[str, object]] = {}
    with kev_path.open(encoding="utf-8") as f:
        for raw in f:
            if len(cve_records) >= args.kev_limit:
                break
            raw = raw.strip()
            if not raw:
                continue
            row = json.loads(raw)
            cve_records.append(row)
            for pkg in row.get("packages") or []:
                if not isinstance(pkg, dict):
                    continue
                name = str(pkg.get("name") or "")
                eco = str(pkg.get("ecosystem") or "")
                if not name:
                    continue
                key = (name, eco)
                if key not in package_map:
                    package_map[key] = {
                        "name": name,
                        "ecosystem": eco,
                    }

    for cve in cve_records:
        props = {
            "id": cve.get("id"),
            "title": cve.get("title"),
            "severity": cve.get("severity"),
            "issued_at": cve.get("issued_at"),
            "source": cve.get("source"),
        }
        lines.append(f"USE GRAPH vulndb; CREATE (:CVE {gql_props(props)});")
    lines.append("")

    lines.append(f"/* Package nodes ({len(package_map)} distinct) */")
    for (name, eco) in sorted(package_map.keys()):
        props = {"name": name, "ecosystem": eco}
        lines.append(f"USE GRAPH vulndb; CREATE (:Package {gql_props(props)});")
    lines.append("")

    # ----- AFFECTS edges (CVE -> Package) -----
    lines.append("/* AFFECTS edges (CVE -> Package) */")
    edge_count = 0
    for cve in cve_records:
        cve_id = cve.get("id")
        if not cve_id:
            continue
        for pkg in cve.get("packages") or []:
            if not isinstance(pkg, dict):
                continue
            name = str(pkg.get("name") or "")
            eco = str(pkg.get("ecosystem") or "")
            if not name:
                continue
            status = str(pkg.get("status") or "")
            edge_props = {"status": status} if status else {}
            edge_lit = gql_props(edge_props) if edge_props else ""
            lines.append(
                "USE GRAPH vulndb; "
                "MATCH (c:CVE {id: " + gql_str(cve_id) + "}), "
                "(p:Package {name: " + gql_str(name) + ", ecosystem: " + gql_str(eco) + "}) "
                + ("CREATE (c)-[:AFFECTS " + edge_lit + "]->(p);"
                   if edge_lit
                   else "CREATE (c)-[:AFFECTS]->(p);")
            )
            edge_count += 1
    lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"wrote {out_path} — CWE={cwe_count}, "
        f"CVE={len(cve_records)}, Package={len(package_map)}, "
        f"AFFECTS={edge_count}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
