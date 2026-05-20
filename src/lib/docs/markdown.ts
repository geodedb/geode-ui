// GAP-061: tiny built-in Markdown→HTML renderer for the in-app docs
// viewer. We avoid pulling in a heavy library (react-markdown +
// remark-* stack) because the in-tree docs are operator-facing
// internal copy, the Electron build ships them offline, and every
// HTML string passes through DOMPurify before reaching the DOM.
//
// Scope: headings (#-######), paragraphs, code fences (```), inline
// code (`), bold (**…**), italic (*…*), unordered + ordered lists,
// blockquotes (>), horizontal rules (---), and inline links
// ([text](url)). Tables, footnotes, GFM strikethrough, and other GFM
// extensions are intentionally NOT supported — the in-tree docs do
// not use them.

import DOMPurify from 'dompurify'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(line: string): string {
  let out = escapeHtml(line)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, '$1<em>$2</em>$3')
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text: string, url: string) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#'
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  )
  return out
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

interface BlockState {
  inCode: boolean
  inList: 'ul' | 'ol' | null
  paragraph: string[]
  out: string[]
}

function flushParagraph(state: BlockState): void {
  if (state.paragraph.length === 0) return
  state.out.push(`<p>${renderInline(state.paragraph.join(' '))}</p>`)
  state.paragraph = []
}

function closeList(state: BlockState): void {
  if (state.inList) {
    state.out.push(state.inList === 'ul' ? '</ul>' : '</ol>')
    state.inList = null
  }
}

// processLine — handles a single line and returns true if it was
// consumed. Splitting the loop body out lets the for-loop stay free
// of `continue` (the project's ESLint config bans it).
function processLine(state: BlockState, line: string): void {
  if (state.inCode) {
    if (line.startsWith('```')) {
      state.out.push('</code></pre>')
      state.inCode = false
    } else {
      state.out.push(escapeHtml(line))
    }
    return
  }
  if (line.startsWith('```')) {
    flushParagraph(state)
    closeList(state)
    state.out.push('<pre><code>')
    state.inCode = true
    return
  }
  const heading = line.match(/^(#{1,6})\s+(.+)$/)
  if (heading) {
    flushParagraph(state)
    closeList(state)
    const level = heading[1]!.length
    const text = heading[2]!
    state.out.push(
      `<h${level} id="${slug(text)}">${renderInline(text)}</h${level}>`
    )
    return
  }
  if (/^---+\s*$/.test(line)) {
    flushParagraph(state)
    closeList(state)
    state.out.push('<hr />')
    return
  }
  const ul = line.match(/^\s*[-*+]\s+(.+)$/)
  if (ul) {
    flushParagraph(state)
    if (state.inList !== 'ul') {
      closeList(state)
      state.out.push('<ul>')
      state.inList = 'ul'
    }
    state.out.push(`<li>${renderInline(ul[1]!)}</li>`)
    return
  }
  const ol = line.match(/^\s*\d+\.\s+(.+)$/)
  if (ol) {
    flushParagraph(state)
    if (state.inList !== 'ol') {
      closeList(state)
      state.out.push('<ol>')
      state.inList = 'ol'
    }
    state.out.push(`<li>${renderInline(ol[1]!)}</li>`)
    return
  }
  const bq = line.match(/^>\s+(.+)$/)
  if (bq) {
    flushParagraph(state)
    closeList(state)
    state.out.push(`<blockquote>${renderInline(bq[1]!)}</blockquote>`)
    return
  }
  if (line.trim() === '') {
    flushParagraph(state)
    closeList(state)
    return
  }
  state.paragraph.push(line.trim())
}

export function renderMarkdown(src: string): string {
  const state: BlockState = {
    inCode: false,
    inList: null,
    paragraph: [],
    out: [],
  }
  const lines = src.split('\n')
  lines.forEach((line) => processLine(state, line))
  flushParagraph(state)
  closeList(state)
  if (state.inCode) state.out.push('</code></pre>')
  const raw = state.out.join('\n')
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'a',
      'blockquote',
      'hr',
      'br',
    ],
    ALLOWED_ATTR: ['href', 'id', 'target', 'rel'],
  })
}
