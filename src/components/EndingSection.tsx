'use client'

import { useState } from 'react'
import ChapterCard from '@/components/ChapterCard'
import CommentThread from '@/components/CommentThread'
import { endingImageUrl } from '@/lib/storage'

export interface SupChunk {
  id: number
  seq: number
  title: string | null
  body: string
}

export interface EndingSup {
  id: number
  level_code: string | null
  seq: number
  image_sha1: string | null
  text_chunks: SupChunk[]
}

type Chapter = {
  id: number
  level_code: string | null
  level_name: string | null
  stage: string | null
  order_in_story: number
}

export default function EndingSection({
  endings,
  supplementMap,
  category,
  storyName,
  id,
  num,
}: {
  endings: Chapter[]
  supplementMap: Map<string, EndingSup>
  category: string
  storyName: string
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

  if (endings.length === 0) return null

  return (
    <section id={id} className="mt-16 first:mt-0 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
        <span className="text-ark-accent">{'//'}</span> {num}{' '}
        <span className="text-ark-border">·</span> ENDINGS{' '}
        <span className="text-ark-border">·</span> 结局{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">
          {endings.length.toString().padStart(2, '0')}
        </span>
      </p>

      <div className="space-y-6">
        {endings.map(chapter => {
          const sup = supplementMap.get(chapter.level_code ?? '')
          const chunks = sup
            ? [...sup.text_chunks].sort((a, b) => a.seq - b.seq)
            : []
          const imgUrl = endingImageUrl(sup?.image_sha1)

          return (
            <div key={chapter.id} className="border border-ark-border bg-ark-surface">
              {imgUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imgUrl}
                  alt=""
                  className="w-full object-cover border-b border-ark-border"
                />
              )}

              <div className="p-5">
                <ChapterCard
                  category={category}
                  storyName={storyName}
                  chapter={chapter}
                />

                {chunks.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-ark-border space-y-4">
                    <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
                      <span className="text-ark-accent">{'//'}</span>{' '}
                      SUPPLEMENT · 补充档案
                    </p>
                    {chunks.map((chunk, j) => {
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
                                {(j + 1).toString().padStart(2, '0')}
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
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
