'use client'

import { useState } from 'react'
import CommentThread from '@/components/CommentThread'

export interface TextChunk {
  id: number
  seq: number
  title: string | null
  body: string
}

export default function PersonnelFileSection({
  chunks,
  id,
  num,
}: {
  chunks: TextChunk[]
  id?: string
  num: string
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const toggle = (chunkId: number) =>
    setCollapsed(s => {
      const next = new Set(s)
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId)
      return next
    })

  if (chunks.length === 0) return null

  const sorted = [...chunks].sort((a, b) => a.seq - b.seq)

  return (
    <section id={id} className="mt-16 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
        <span className="text-ark-accent">{'//'}</span> {num}{' '}
        <span className="text-ark-border">·</span> PERSONNEL FILE{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="normal-case">人员档案</span>{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">{sorted.length.toString().padStart(2, '0')}</span>
      </p>
      <div className="space-y-1">
        {sorted.map(chunk => {
          const isCollapsed = collapsed.has(chunk.id)
          return (
            <div key={chunk.id} className="border border-ark-border bg-ark-surface">
              <button
                type="button"
                onClick={() => toggle(chunk.id)}
                className="w-full flex items-center justify-between px-4 py-3
                           hover:bg-ark-bg/50 transition-colors"
              >
                <span className="font-mono text-[11px] text-ark-accent tracking-widest uppercase">
                  {chunk.title ?? `#${chunk.seq}`}
                </span>
                <span className="font-mono text-[10px] text-ark-border ml-3 shrink-0">
                  {isCollapsed ? '[+]' : '[−]'}
                </span>
              </button>
              {!isCollapsed && (
                <div className="px-4 pb-4 border-t border-ark-border/40">
                  <p className="text-sm leading-relaxed text-ark-muted whitespace-pre-wrap pt-3">
                    {chunk.body}
                  </p>
                  <CommentThread
                    anchor={{ text_chunk_id: chunk.id }}
                    initialCount={0}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
