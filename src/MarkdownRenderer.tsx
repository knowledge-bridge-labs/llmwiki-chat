import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { Citation } from './domain'

const markdownBlockedMediaTags = new Set(['img', 'picture', 'source'])
const wikiLinkHrefPrefix = '#llmwiki-wikilink/'
const wikiLinkMarkdownPattern = String.raw`\[\[[^[\]\n]+?\]\]`
const wikiLinkNavigationLinePattern = new RegExp(
  String.raw`^\s*${wikiLinkMarkdownPattern}(?:\s*\|\s*${wikiLinkMarkdownPattern})+\s*$`,
)
const wikiLinkSeparatorPattern = /^[\s|]+$/
const markdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((tagName) => !markdownBlockedMediaTags.has(tagName)),
  attributes: Object.fromEntries(
    Object.entries(defaultSchema.attributes || {}).filter(([tagName]) => !markdownBlockedMediaTags.has(tagName)),
  ),
}

export function MarkdownAnswer({
  text,
  citations,
  citationReferenceIds = [],
  selectedCitationId,
  selectedCitationMessageId,
  messageId,
  onSelectCitation,
  citationForMarkdownReference,
  citationActionLabel,
  citationInlineChildren,
}: {
  text: string
  citations: Citation[]
  citationReferenceIds?: string[]
  selectedCitationId: string
  selectedCitationMessageId: string
  messageId: string
  onSelectCitation: (citation: Citation) => void
  citationForMarkdownReference: (
    href: string | undefined,
    children: ReactNode,
    citations: Citation[],
    citationReferenceIds?: string[],
  ) => Citation | null
  citationActionLabel: (citation: Citation, citations: Citation[]) => string
  citationInlineChildren: (children: ReactNode, citation: Citation, citations: Citation[]) => ReactNode
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
      components={{
        a({ href, children, node, ...props }) {
          void node
          const citation = citationForMarkdownReference(href, children, citations, citationReferenceIds)
          if (citation) {
            return (
              <button
                type="button"
                className="inline-citation"
                data-citation-id={citation.id}
                aria-label={citationActionLabel(citation, citations)}
                aria-controls="details-panel"
                aria-pressed={selectedCitationId === citation.id && (!selectedCitationMessageId || selectedCitationMessageId === messageId)}
                onClick={() => onSelectCitation(citation)}
              >
                {citationInlineChildren(children, citation, citations)}
              </button>
            )
          }
          return <a href={href} {...props}>{children}</a>
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

export function PageMarkdown({
  pageRead,
  resolveWikiTarget,
  onSelectNode,
}: {
  pageRead: {
    status: 'loading' | 'ready' | 'error'
    markdown: string
    path: string
    error: string
  } | null
  resolveWikiTarget: (target: string) => string | null
  onSelectNode: (nodeId: string) => void
}) {
  if (!pageRead) return null

  const displayMarkdown = pageMarkdownForDisplay(pageRead.markdown)

  return (
    <article className="page-markdown-card" aria-label="Selected page markdown">
      <div className="page-markdown-heading">
        <strong>Rendered page</strong>
        {pageRead.path ? <span>{pageRead.path}</span> : null}
      </div>
      {pageRead.status === 'loading' ? (
        <p className="status-line checking">Loading full markdown...</p>
      ) : pageRead.status === 'error' ? (
        <p className="status-line error">{pageRead.error || 'Could not load page markdown.'}</p>
      ) : pageRead.markdown.trim() ? (
        <div className="page-markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
            skipHtml
            components={{
              p({ children, node, ...props }) {
                void node
                const rowChildren = wikiLinkRowChildren(children)
                if (rowChildren) {
                  return (
                    <nav className="wiki-link-row" aria-label="Page links">
                      {rowChildren}
                    </nav>
                  )
                }
                return <p {...props}>{children}</p>
              },
              a({ href, children, node, ...props }) {
                void node
                const wikiTarget = wikiTargetFromHref(href)
                if (!wikiTarget) return <a href={href} {...props}>{children}</a>

                const targetNodeId = resolveWikiTarget(wikiTarget)
                if (!targetNodeId) {
                  return (
                    <span className="wiki-link" title={wikiTarget} data-wiki-link="true">
                      {children}
                    </span>
                  )
                }

                return (
                  <button
                    type="button"
                    className="wiki-link wiki-link-button"
                    title={wikiTarget}
                    data-wiki-link="true"
                    aria-controls="details-panel"
                    onClick={() => onSelectNode(targetNodeId)}
                  >
                    {children}
                  </button>
                )
              },
            }}
          >
            {displayMarkdown}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="status-line blocked">No markdown was returned for this page.</p>
      )}
    </article>
  )
}

function pageMarkdownForDisplay(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const displayLine = line
        .split(/(`[^`]*`)/g)
        .map((segment) => segment.startsWith('`') ? segment : replaceWikiLinks(segment))
        .join('')
      return wikiLinkNavigationLinePattern.test(line) ? `\n${displayLine}\n` : displayLine
    })
    .join('\n')
}

function replaceWikiLinks(value: string): string {
  return value.replace(/\[\[([^[\]\n]+?)\]\]/g, (_, rawInner: string) => {
    const link = parseWikiLink(rawInner)
    if (!link.target) return rawInner
    return `[${escapeMarkdownLinkText(link.label)}](${wikiLinkHref(link.target)})`
  })
}

function parseWikiLink(rawInner: string): { target: string; label: string } {
  const [rawTarget = '', rawLabel = ''] = rawInner.split('|')
  const target = rawTarget.trim()
  const label = rawLabel.trim() || wikiLinkDefaultLabel(target)
  return { target, label }
}

function wikiLinkDefaultLabel(target: string): string {
  const withoutHeading = target.split('#').filter(Boolean).at(-1) || target
  const basename = withoutHeading.split(/[\\/]/).filter(Boolean).at(-1) || withoutHeading
  return basename.trim() || target
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1')
}

function wikiLinkHref(target: string): string {
  return `${wikiLinkHrefPrefix}${encodeURIComponent(target)}`
}

function wikiTargetFromHref(href: string | undefined): string {
  if (!href?.startsWith(wikiLinkHrefPrefix)) return ''
  try {
    return decodeURIComponent(href.slice(wikiLinkHrefPrefix.length))
  } catch {
    return href.slice(wikiLinkHrefPrefix.length)
  }
}

type WikiLinkElementProps = {
  'data-wiki-link'?: string
  href?: string
}

function wikiLinkRowChildren(children: ReactNode): ReactNode[] | null {
  const childItems = Children.toArray(children)
  const rowChildren: ReactNode[] = []

  for (const child of childItems) {
    if (isWikiLinkElement(child)) {
      rowChildren.push(child)
      continue
    }

    if (typeof child === 'string' && wikiLinkSeparatorPattern.test(child)) continue
    return null
  }

  return rowChildren.length >= 2 ? rowChildren : null
}

function isWikiLinkElement(child: ReactNode): child is ReactElement<WikiLinkElementProps> {
  if (!isValidElement<WikiLinkElementProps>(child)) return false
  return child.props['data-wiki-link'] === 'true' || Boolean(child.props.href?.startsWith(wikiLinkHrefPrefix))
}
