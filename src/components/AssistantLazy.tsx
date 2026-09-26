'use client'

// The AI terminal's launcher pill, and nothing else.
//
// `Header` is in the root layout, so whatever it imports ships on EVERY page.
// It imported `Assistant` statically — gated at render time by `canUseAi`, but
// an import is not a render, so the chunk shipped regardless of the gate and
// regardless of whether anyone opened the panel.
//
// That chunk is not small. Assistant -> AiTranscript -> CommentMarkdown pulls
// in react-markdown, remark-gfm, remark-breaks and rehype-sanitize: measured at
// 150 KB uncompressed on a production build, eagerly loaded on every route in
// the app, to render a button that says 「⌘ AI 分析」.
//
// So the panel is imported when it is opened. The launcher is duplicated here
// rather than shared, for the same reason as CommentThreadLazy: a shared module
// would be imported by both and land back in the initial bundle.

import { useState } from 'react'
import dynamic from 'next/dynamic'

const Assistant = dynamic(() => import('@/components/Assistant'), {
  ssr: false,
  loading: () => (
    <span className="fixed bottom-6 right-6 z-[60] px-3 py-2.5 bg-ark-bg/95
                     border border-ark-accent/60 text-ark-accent font-mono
                     text-[11px] tracking-[0.2em] uppercase">
      载入中…
    </span>
  ),
})

export default function AssistantLazy() {
  const [open, setOpen] = useState(false)

  if (open) return <Assistant startOpen />

  return (
    <button
      onClick={() => setOpen(true)}
      aria-label="打开 AI 分析终端"
      className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 pl-3 pr-3.5 py-2.5
                 bg-ark-bg/95 backdrop-blur-sm border border-ark-accent/60 text-ark-accent
                 font-mono text-[11px] tracking-[0.2em] uppercase
                 hover:bg-ark-accent hover:text-ark-bg transition-colors
                 shadow-2xl shadow-ark-accent/10"
      style={{ clipPath: 'polygon(0 0, 100% 0, 100% 65%, 90% 100%, 0 100%)' }}
    >
      <span className="text-base leading-none">⌘</span>
      <span>AI 分析</span>
    </button>
  )
}
