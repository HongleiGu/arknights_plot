'use client'

import { useState } from 'react'
import CommentThread from '@/components/CommentThread'

export interface TextChunk {
  id: number
  seq: number
  title: string | null
  body: string
}

export interface CharacterRecord {
  id: number
  title: string | null       // character name (text_clusters.title)
  title_en: string | null
  seq: number
  text_chunks: TextChunk[]
}

export default function CharacterRecords({
  records,
  id,
}: {
  records: CharacterRecord[]
  id?: string
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const toggle = (chunkId: number) =>
    setCollapsed(s => {
      const next = new Set(s)
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId)
      return next
    })

  if (records.length === 0) return null

  return (
    <section id={id} className="mt-16 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
        <span className="text-ark-accent">{'//'}</span> RECORDS{' '}
        <span className="text-ark-border">·</span> 角色记录{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">
          {records.length.toString().padStart(2, '0')}
        </span>
      </p>

      <div className="space-y-6 mt-6">
        {records.map(c => {
          const chunks = [...c.text_chunks].sort((a, b) => a.seq - b.seq)
          return (
            <div key={c.id} className="border border-ark-border bg-ark-surface p-5">
              <div className="flex items-baseline gap-3 mb-4">
                <h3 className="text-base text-ark-text tracking-wide">
                  {c.title ?? `#${c.id}`}
                </h3>
                {c.title_en && (
                  <span className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
                    {c.title_en}
                  </span>
                )}
              </div>
              <div className="space-y-4">
                {chunks.map((chunk, i) => {
                  const isCollapsed = collapsed.has(chunk.id)
                  return (
                    <div key={chunk.id} className="border-l-2 border-ark-accent/40 pl-4">
                      <div className="flex items-center justify-between mb-1.5">
                        {chunk.title ? (
                          <p className="font-mono text-[10px] text-ark-accent tracking-widest">
                            {chunk.title}
                          </p>
                        ) : (
                          <p className="font-mono text-[10px] text-ark-border tracking-widest">
                            <span className="text-ark-accent">{'//'}</span>{' '}
                            {(i + 1).toString().padStart(2, '0')}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(chunk.id)}
                          className="font-mono text-[10px] text-ark-border hover:text-ark-accent
                                     transition-colors ml-3 shrink-0"
                        >
                          {isCollapsed ? '[+]' : '[−]'}
                        </button>
                      </div>
                      {!isCollapsed && (
                        <>
                          <p className="text-sm leading-relaxed text-ark-muted whitespace-pre-wrap">
                            {chunk.body}
                          </p>
                          <CommentThread
                            anchor={{ text_chunk_id: chunk.id }}
                            initialCount={0}
                          />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
