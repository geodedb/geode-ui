// matchPattern — minimal best-effort GQL/Cypher pattern parser.
//
// Used by the graph view to reconstruct nodes / edges when the user
// projects only scalar properties (e.g. `RETURN p.name, r.roles,
// m.title`). The Geode wire response in that case carries an empty
// graph_summary, so we have no node IDs and no edge endpoints to
// render. Falling back to "show nothing" loses the relationship
// shape the user clearly expressed in their MATCH pattern.
//
// We parse two pieces of the query:
//
//   1. MATCH clauses — yield variable bindings: `(p:Person)`, edges
//      between them with type and direction `[r:ACTED_IN]->`. We
//      tolerate multiple MATCH clauses, mixed direction arrows, and
//      anonymous nodes (we only track named ones since only those
//      can show up in the RETURN list).
//   2. RETURN expressions — yield, for each output column, the
//      (variable, field) the user typed. Geode auto-aliases dotted
//      expressions to the bare field name (`p.name` becomes column
//      `name`), so the only place to recover the variable is the
//      query text itself.
//
// What we do NOT parse: WHERE filters, MERGE, OPTIONAL MATCH,
// variable-length paths, `*` ranges, MATCH inside subqueries, full
// expression syntax in RETURN. The graph view falls back to its
// existing behaviour when the parser can't extract enough.
//
// All matchers are regex-based for simplicity. Geode v0.5.11's
// dialect is small; if a query trips the parser, the caller just
// gets an empty result and the existing extractElements fallback
// kicks in.

export type NodeBinding = {
  varName: string
  label?: string
}

export type EdgeBinding = {
  varName: string
  type?: string
  fromVar: string
  toVar: string
  // direction the user wrote: -[]-> = forward, <-[]- = backward,
  // -[]- = undirected. The graph view always renders an arrow, so we
  // canonicalise the (from, to) ordering and drop the symmetric
  // case down to forward at extraction time.
  directed: boolean
}

export type ReturnColumn = {
  varName?: string // present if the expression was `var.field`
  field?: string // the property name (when var.field)
  // For raw variable returns like `RETURN p, r, m` we leave field
  // unset and varName carries the whole identifier — this is the
  // existing-NODE-or-EDGE return shape that extractElements handles
  // natively, so we don't need to do anything with it here.
  raw: string
}

export type ParsedMatch = {
  nodes: Map<string, NodeBinding>
  edges: EdgeBinding[]
  returnColumns: ReturnColumn[]
}

// Strip /* ... */ block comments and -- line comments before parsing
// so noise inside the user's query doesn't confuse the regex
// matchers below.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

// Find each MATCH clause body (terminated by RETURN, WHERE,
// MATCH-again, OPTIONAL, MERGE, CREATE, SET, DELETE, REMOVE,
// WITH, UNWIND, ORDER, LIMIT, ;, end-of-string).
const MATCH_TERMINATORS =
  /\b(?:RETURN|WHERE|MATCH|OPTIONAL|MERGE|CREATE|SET|DELETE|REMOVE|WITH|UNWIND|ORDER|LIMIT|SKIP|CALL|USE)\b|;|$/i

function matchClauseBodies(query: string): string[] {
  const re = /\bMATCH\b/gi
  const out: string[] = []
  Array.from(query.matchAll(re)).forEach((m) => {
    if (m.index === undefined) return
    const start = m.index + m[0].length
    const tail = query.slice(start)
    const term = MATCH_TERMINATORS.exec(tail)
    const end = term ? term.index : tail.length
    out.push(tail.slice(0, end))
  })
  return out
}

// Patterns supported in MATCH bodies:
//   (a)            anonymous node (no varName)
//   (a:Label)      labelled node, named
//   (a:Label {p}) — properties dropped, body stays well-formed
//   -[r:Type]->    forward edge
//   <-[r:Type]-    backward edge
//   -[r:Type]-     undirected
//   ,              starts a new disjoint pattern (resets cursor)
const TOKEN_RE =
  /\(\s*([A-Za-z_][\w]*)?(?:\s*:\s*([A-Za-z_][\w]*))?(?:\s*\{[^}]*\})?\s*\)|<?-\s*\[\s*([A-Za-z_][\w]*)?(?:\s*:\s*([A-Za-z_][\w]*))?(?:\s*\{[^}]*\})?\s*\]\s*->?|,/g

function parseMatchBody(
  body: string,
  nodes: Map<string, NodeBinding>,
  edges: EdgeBinding[]
): void {
  let prevNode: string | null = null
  let pendingEdge: {
    name?: string
    type?: string
    directed: boolean
    rev: boolean
  } | null = null
  Array.from(body.matchAll(TOKEN_RE)).forEach((m) => {
    const tok = m[0]
    if (tok === ',') {
      prevNode = null
      pendingEdge = null
    } else if (tok.startsWith('(')) {
      const name = m[1]
      const label = m[2]
      if (name) {
        if (!nodes.has(name)) {
          nodes.set(name, { varName: name, label })
        } else if (label && !nodes.get(name)!.label) {
          nodes.set(name, { varName: name, label })
        }
      }
      if (pendingEdge && prevNode && name) {
        const fromVar = pendingEdge.rev ? name : prevNode
        const toVar = pendingEdge.rev ? prevNode : name
        edges.push({
          varName: pendingEdge.name ?? '',
          type: pendingEdge.type,
          fromVar,
          toVar,
          directed: pendingEdge.directed,
        })
      }
      prevNode = name ?? prevNode
      pendingEdge = null
    } else {
      const rev = tok.startsWith('<')
      const fwd = tok.endsWith('->')
      pendingEdge = {
        name: m[3],
        type: m[4],
        directed: rev || fwd,
        rev,
      }
    }
  })
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
    } else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  if (start < s.length) out.push(s.slice(start))
  return out
}

function parseReturnExpr(expr: string): ReturnColumn {
  // Strip a trailing AS alias if present so we don't include it in
  // the var/field extraction. The alias becomes the column name in
  // the response — we just need to recover the variable+field.
  const aliasMatch = / AS \b/i.exec(expr)
  const aliasIdx = aliasMatch ? aliasMatch.index : -1
  const lhs = aliasIdx >= 0 ? expr.slice(0, aliasIdx).trim() : expr.trim()

  // Match `var.field` (where field is a simple identifier — function
  // calls and indexers fall through to the raw bucket).
  const dot = lhs.match(/^([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/)
  if (dot) {
    return { raw: expr, varName: dot[1], field: dot[2] }
  }
  // Bare variable: `RETURN p`. Caller may treat as a NODE or EDGE
  // return; we don't synthesise from these because the response
  // already carries the full object in graph_summary.
  const bare = lhs.match(/^([A-Za-z_][\w]*)$/)
  if (bare) {
    return { raw: expr, varName: bare[1] }
  }
  return { raw: expr }
}

function parseReturnList(query: string): ReturnColumn[] {
  const m = query.match(
    /\bRETURN\b\s+([\s\S]+?)(?:\bORDER\b|\bSKIP\b|\bLIMIT\b|;|$)/i
  )
  if (!m || !m[1]) return []
  const list = m[1]
  return splitTopLevel(list, ',').map((expr) => parseReturnExpr(expr.trim()))
}

export function parseMatchAndReturn(query: string): ParsedMatch {
  const text = stripComments(query)
  const nodes = new Map<string, NodeBinding>()
  const edges: EdgeBinding[] = []
  matchClauseBodies(text).forEach((body) => {
    parseMatchBody(body, nodes, edges)
  })
  const returnColumns = parseReturnList(text)
  return { nodes, edges, returnColumns }
}
