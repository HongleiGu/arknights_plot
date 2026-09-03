'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeSanitize from 'rehype-sanitize'
import type { ReferenceData } from '@/lib/references'

// Public base of our R2 bucket — the ONLY origin we render images from, so a
// comment can't smuggle in a tracking pixel / external image (IP leak).
const R2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

// `@type/id` cross-reference tokens (AP-2). Kept in sync with lib/references.
const REF_RE = /@(story|chapter|node|gadget|event|option|text|furniture|entity|enemy|item|user)\/(\d+)/g

const TYPE_ICON: Record<string, string> = {
  user: '@', story: '◈', chapter: '§', node: '¶', gadget: '◆',
  event: '❖', option: '▸', text: '✎', furniture: '⌂', entity: '☗',
}

// Escape characters that would break a markdown link label.
function escapeLabel(s: string): string {
  return s.replace(/[\\[\]]/g, '\\$&')
}

/**
 * Render a comment body as sanitized GitHub-flavoured markdown (AP-7) with
 * `@type/id` cross-reference chips (AP-2).
 *
 * - rehype-sanitize strips scripts / event handlers / unsafe protocols.
 * - Links open in a new tab with rel="noopener noreferrer nofollow ugc".
 * - Images render ONLY from our R2 origin; anything else is dropped.
 * - Resolved `@type/id` tokens become inline chips with a hover preview.
 * - `leadInline`: render the first paragraph inline so it sits on the same
 *   line as a preceding `@mention`.
 */
export default function CommentMarkdown({
  body,
  leadInline = false,
  references = [],
}: {
  body: string
  leadInline?: boolean
  references?: ReferenceData[]
}) {
  const refByKey = new Map(references.map(r => [r.key, r]))

  // Rewrite resolved references into hash links the `a` override picks up.
  // Unknown tokens are left as plain text.
  const source = references.length
    ? body.replace(REF_RE, (m, type, id) => {
        const ref = refByKey.get(`${type}/${id}`)
        return ref ? `[${escapeLabel(ref.label)}](#cmtref-${type}-${id})` : m
      })
    : body

  return (
    <span className={leadInline ? 'inline' : 'block'}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        p: ({ children }) => (
          <span
            className={`block leading-relaxed [&:not(:first-child)]:mt-1.5
                        ${leadInline ? 'first:inline' : ''}`}
          >
            {children}
          </span>
        ),
        a: ({ href, children }) => {
          const m = typeof href === 'string' ? href.match(/^#cmtref-(\w+)-(\d+)$/) : null
          if (m) {
            const ref = refByKey.get(`${m[1]}/${m[2]}`)
            if (ref) return <ReferenceChip data={ref} />
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="text-ark-accent underline underline-offset-2 hover:text-ark-accent-bright break-all"
            >
              {children}
            </a>
          )
        },
        img: ({ src, alt }) => {
          if (typeof src !== 'string' || !R2 || !src.startsWith(R2)) return null
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={src} alt={alt ?? ''} className="max-w-full max-h-80 rounded my-2 border border-ark-border" />
        },
        ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-ark-border pl-3 my-1.5 text-ark-muted">{children}</blockquote>
        ),
        code: ({ children, className }) => {
          const block = (className ?? '').includes('language-')
          return block
            ? <code className="block bg-ark-surface border border-ark-border rounded p-2 my-1.5 overflow-x-auto font-mono text-[12px]">{children}</code>
            : <code className="bg-ark-surface border border-ark-border rounded px-1 py-0.5 font-mono text-[12px]">{children}</code>
        },
        pre: ({ children }) => <pre className="my-1.5">{children}</pre>,
        h1: ({ children }) => <p className="font-medium text-ark-text my-1.5">{children}</p>,
        h2: ({ children }) => <p className="font-medium text-ark-text my-1.5">{children}</p>,
        h3: ({ children }) => <p className="font-medium text-ark-text my-1.5">{children}</p>,
      }}
    >
      {source}
    </ReactMarkdown>
    </span>
  )
}


/** Inline cross-reference chip with a hover/focus preview card. */
function ReferenceChip({ data }: { data: ReferenceData }) {
  const chip = (
    <span
      tabIndex={0}
      className="inline-flex items-baseline gap-0.5 px-1.5 py-0.5 rounded align-baseline
                 bg-ark-accent/10 border border-ark-accent/30 text-ark-accent text-[13px]
                 hover:bg-ark-accent/20 transition-colors cursor-pointer outline-none"
    >
      <span aria-hidden className="font-mono text-[11px] opacity-70">{TYPE_ICON[data.type] ?? '#'}</span>
      {data.label}
    </span>
  )
  return (
    <span className="relative inline-block group align-baseline">
      {data.href ? <Link href={data.href} className="no-underline">{chip}</Link> : chip}
      <span
        className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100
                   group-focus-within:visible group-focus-within:opacity-100
                   absolute left-0 top-full z-30 mt-1 w-64 p-2.5
                   bg-ark-bg border border-ark-border shadow-2xl transition-opacity"
      >
        <span className="block font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-1">
          {'//'} {data.type}
        </span>
        <span className="block text-sm text-ark-text font-medium">{data.label}</span>
        {data.preview && (
          <span className="block text-xs text-ark-muted mt-1 leading-relaxed line-clamp-4">{data.preview}</span>
        )}
        {data.href && <span className="block font-mono text-[10px] text-ark-accent tracking-widest mt-1.5">打开 →</span>}
      </span>
    </span>
  )
}
