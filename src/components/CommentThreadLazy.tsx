'use client'

// The collapsed state of a comment thread, and nothing else.
//
// A chapter page renders one thread per paragraph — 35 on a typical page of
// 大地巡旅 — and every one of them was pulling the whole comment system into the
// initial bundle to draw a button that says `// 00 COMMENTS +`. Measured on a
// production build of that page: 1.06 MB of JS, of which ~204 KB is the comment
// machinery (CommentMarkdown alone is 150 KB, a markdown renderer that cannot
// matter until a thread is actually open).
//
// So the heavy module is imported on click instead. `next/dynamic` puts
// CommentThread in its own chunk, fetched the first time a reader opens a
// thread; until then this component is a button and a boolean.
//
// The closed markup is duplicated from CommentThread rather than shared,
// deliberately: extracting it into a module both files import would put that
// module back in the initial bundle, which is the thing being avoided. The two
// must stay in step — they are a dozen lines and the divergence would be
// visible immediately.

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { Anchor } from '@/app/actions/comments'

const CommentThread = dynamic(() => import('@/components/CommentThread'), {
  // No SSR: the collapsed button below is what the server renders, and this
  // only ever mounts after a click.
  ssr: false,
  loading: () => (
    <span className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
      {'//'} 载入中…
    </span>
  ),
})

interface Props {
  anchor: Anchor
  initialCount: number
  indent?: string
}

export default function CommentThreadLazy({ anchor, initialCount, indent = 'ml-12' }: Props) {
  const [open, setOpen] = useState(false)

  if (open) {
    return <CommentThread anchor={anchor} initialCount={initialCount}
                          indent={indent} startOpen />
  }

  return (
    <div className={`${indent} mt-0.5 mb-1.5`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`font-mono text-[10px] tracking-widest uppercase
                    ${initialCount > 0 ? 'text-ark-accent' : 'text-ark-border'}
                    hover:text-ark-accent-bright transition-colors`}
        aria-expanded={false}
      >
        {'//'} {initialCount.toString().padStart(2, '0')}
        {' COMMENT'}{initialCount === 1 ? '' : 'S'} {'+'}
      </button>
    </div>
  )
}
