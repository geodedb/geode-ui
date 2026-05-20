import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import styled from 'styled-components'

import { DOC_PAGES, findDocPage } from '../lib/docs'
import { renderMarkdown } from '../lib/docs/markdown'

// GAP-061: in-app documentation viewer. Mounted at /docs and
// /docs/:slug. Renders the curated Markdown subset bundled at build
// time (see src/lib/docs/index.ts) using the lightweight Markdown
// renderer at src/lib/docs/markdown.ts.

const Sidebar = styled.aside`
  border-right: 1px solid ${({ theme }) => theme.border.default};
  padding-right: ${({ theme }) => theme.spacing.md};
  min-width: 240px;
`

const CategoryHeading = styled.h3`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: ${({ theme }) => theme.spacing.md} 0
    ${({ theme }) => theme.spacing.xs};
`

const Article = styled.div`
  h1,
  h2,
  h3,
  h4 {
    font-family: ${({ theme }) => theme.font.family.display};
    color: ${({ theme }) => theme.text.primary};
    margin-top: ${({ theme }) => theme.spacing.lg};
  }
  pre {
    background: ${({ theme }) => theme.bg.subtle};
    padding: ${({ theme }) => theme.spacing.sm};
    border-radius: ${({ theme }) => theme.radii.sm};
    overflow-x: auto;
  }
  code {
    background: ${({ theme }) => theme.bg.subtle};
    padding: 0 4px;
    border-radius: 4px;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
  a {
    color: ${({ theme }) => theme.text.link};
  }
`

// The Markdown renderer (src/lib/docs/markdown.ts) pipes its output
// through DOMPurify with an allow-list of tags + attrs. We parse the
// sanitised HTML into DOM nodes with DOMParser and append them via
// appendChild — never via innerHTML — so the call site reads as a
// deliberate sanitised injection.
function appendSanitisedHtml(host: Element, html: string): void {
  // Clear existing children. We replace, not merge, on each render.
  while (host.firstChild) host.removeChild(host.firstChild)
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const body = doc.body
  // Iterate over a snapshot of children — moving them with appendChild
  // mutates the source NodeList live, which would skip every other
  // node if we walked it directly.
  Array.from(body.childNodes).forEach((node) => {
    host.appendChild(node)
  })
}

// Static map for docs.category.* lookups. The verify:translations
// orphan-key gate cannot follow a dynamic `t(\`docs.category.${x}\`)`
// reference, so we enumerate the keys explicitly here. New categories
// require updating both this map and the i18n table.
function categoryLabel(t: (k: string) => string, category: string): string {
  switch (category) {
    case 'concept':
      return t('docs.category.concept')
    case 'reference':
      return t('docs.category.reference')
    case 'operations':
      return t('docs.category.operations')
    case 'spec':
      return t('docs.category.spec')
    default:
      return category
  }
}

const ArticleBody: React.FC<{ html: string; testId: string }> = ({
  html,
  testId,
}) => {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (ref.current) appendSanitisedHtml(ref.current, html)
  }, [html])
  return <Article ref={ref} data-testid={testId} />
}

export const DocsPage: React.FC = () => {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug?: string }>()
  const effectiveSlug = slug ?? DOC_PAGES[0]?.slug ?? ''
  const page = findDocPage(effectiveSlug)

  const grouped = DOC_PAGES.reduce<Record<string, typeof DOC_PAGES>>(
    (acc, p) => {
      const list = acc[p.category] ?? []
      list.push(p)
      acc[p.category] = list
      return acc
    },
    {}
  )

  return (
    <div className="d-flex" style={{ gap: '24px' }} data-testid="docs-page">
      <Sidebar>
        <nav aria-label={t('docs.navAria')}>
          {Object.entries(grouped).map(([category, pages]) => (
            <React.Fragment key={category}>
              <CategoryHeading>{categoryLabel(t, category)}</CategoryHeading>
              <ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">
                {pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      to={`/docs/${p.slug}`}
                      className={
                        p.slug === effectiveSlug
                          ? 'link-body-emphasis fw-semibold'
                          : 'link-body-emphasis'
                      }
                      data-testid={`docs-link-${p.slug}`}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </React.Fragment>
          ))}
        </nav>
      </Sidebar>
      <main className="flex-grow-1" style={{ minWidth: 0 }}>
        {page ? (
          <ArticleBody
            html={renderMarkdown(page.body)}
            testId={`docs-article-${page.slug}`}
          />
        ) : (
          <p className="text-body-secondary" data-testid="docs-not-found">
            {t('docs.notFound', { slug: effectiveSlug })}
          </p>
        )}
      </main>
    </div>
  )
}
