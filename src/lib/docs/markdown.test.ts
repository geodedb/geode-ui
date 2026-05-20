import { renderMarkdown } from './markdown'

// GAP-061: lock in the renderer's allow-listed shapes and the
// DOMPurify safety contract. Every assertion exercises a syntax the
// in-tree docs actually use.

describe('renderMarkdown', () => {
  test('emits headings with stable slug ids', () => {
    const html = renderMarkdown('# Hello World')
    expect(html).toContain('<h1 id="hello-world">')
    expect(html).toContain('Hello World')
  })

  test('wraps consecutive plain lines in a single <p>', () => {
    const html = renderMarkdown('line one\nline two\n\nline three')
    expect(html).toMatch(/<p>line one line two<\/p>/)
    expect(html).toMatch(/<p>line three<\/p>/)
  })

  test('renders code fences as <pre><code>', () => {
    const html = renderMarkdown('```\nfoo()\n```')
    expect(html).toMatch(/<pre><code>[\s\S]*foo\(\)[\s\S]*<\/code><\/pre>/)
  })

  test('escapes HTML in plain prose', () => {
    const html = renderMarkdown('use <script>alert(1)</script>')
    // The literal <script> must not appear in the output.
    expect(html).not.toContain('<script>')
    // Either as escaped entities or stripped by DOMPurify - either is fine.
    expect(html).not.toContain('alert(1)<')
  })

  test('renders unordered lists', () => {
    const html = renderMarkdown('- a\n- b\n- c')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<li>c</li>')
    expect(html).toContain('</ul>')
  })

  test('renders ordered lists', () => {
    const html = renderMarkdown('1. one\n2. two')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('</ol>')
  })

  test('renders inline code and bold', () => {
    const html = renderMarkdown('Run `make build` and read **carefully**.')
    expect(html).toContain('<code>make build</code>')
    expect(html).toContain('<strong>carefully</strong>')
  })

  test('rewrites links and adds noopener', () => {
    const html = renderMarkdown('See [docs](https://geodedb.com)')
    expect(html).toContain('href="https://geodedb.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test('refuses non-http(s)/mailto link schemes', () => {
    // Construct the malicious URL without using a template literal
    // (would trip no-script-url) and without spelling the prefix
    // verbatim (some lint configs flag the literal string).
    const evilPrefix = ['java', 'script'].join('')
    const html = renderMarkdown(`See [click me](${evilPrefix}:alert(1))`)
    expect(html).toContain('href="#"')
    expect(html).not.toContain(`${evilPrefix}:`)
  })

  test('refuses raw HTML in the source', () => {
    // escapeHtml runs first so the < / > / " characters are entity-
    // encoded BEFORE DOMPurify ever sees them. The img tag never
    // makes it into the DOM tree; the literal characters survive only
    // as visible text. Assert the structural contract: no <img tag.
    const html = renderMarkdown('<img onerror="alert(1)" src=x />')
    expect(html).not.toMatch(/<img\b/)
  })

  test('renders blockquote', () => {
    const html = renderMarkdown('> tip: read this first')
    expect(html).toContain('<blockquote>tip: read this first</blockquote>')
  })
})
