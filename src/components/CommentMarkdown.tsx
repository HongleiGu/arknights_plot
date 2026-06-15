'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeSanitize from 'rehype-sanitize'

// Public base of our R2 bucket — the ONLY origin we render images from, so a
// comment can't smuggle in a tracking pixel / external image (IP leak). Until
// AP-10 (media upload) lands there's no way to produce such a URL anyway.
const R2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

/**
 * Render a comment body as sanitized GitHub-flavoured markdown (AP-7).
 *
 * - rehype-sanitize strips scripts / event handlers / unsafe protocols.
 * - Links open in a new tab with rel="noopener noreferrer nofollow ugc".
 * - Images render ONLY from our R2 origin; anything else is dropped.
 * - `leadInline`: render the first paragraph inline so it sits on the same
 *   line as a preceding `@mention`; later paragraphs/blocks stack normally.
 */
export default function CommentMarkdown({
  body,
  leadInline = false,
}: {
  body: string
  leadInline?: boolean
}) {
  return (
    <span className={leadInline ? 'inline' : 'block'}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        // Paragraphs stack as blocks; with `leadInline`, the FIRST one renders
        // inline (CSS `first:inline`) so it sits on the same line as a
        // preceding @mention. No render-time mutation.
        p: ({ children }) => (
          <span
            className={`block leading-relaxed [&:not(:first-child)]:mt-1.5
                        ${leadInline ? 'first:inline' : ''}`}
          >
            {children}
          </span>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-ark-accent underline underline-offset-2 hover:text-ark-accent-bright break-all"
          >
            {children}
          </a>
        ),
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
      {body}
    </ReactMarkdown>
    </span>
  )
}
