'use client'

import { type TextChunk } from '@/components/PersonnelFileSection'
import CommentThread from '@/components/CommentThread'

export default function VoiceRecordSection({
  chunks,
  id,
  num,
}: {
  chunks: TextChunk[]
  id?: string
  num: string
}) {
  if (chunks.length === 0) return null

  const sorted = [...chunks].sort((a, b) => a.seq - b.seq)

  return (
    <section id={id} className="mt-16 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
        <span className="text-ark-accent">{'//'}</span> {num}{' '}
        <span className="text-ark-border">·</span> VOICE RECORDS{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="normal-case">语音记录</span>{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">{sorted.length.toString().padStart(2, '0')}</span>
      </p>
      <div className="border border-ark-border divide-y divide-ark-border/60">
        {sorted.map(chunk => (
          <div
            key={chunk.id}
            className="grid grid-cols-[9rem,1fr] gap-4 px-4 py-3
                       hover:bg-ark-surface/50 transition-colors"
          >
            <span className="font-mono text-[10px] text-ark-accent tracking-widest
                             uppercase pt-0.5 leading-relaxed shrink-0">
              {chunk.title}
            </span>
            <div>
              <p className="text-sm text-ark-muted leading-relaxed">
                {chunk.body}
              </p>
              <CommentThread
                anchor={{ text_chunk_id: chunk.id }}
                initialCount={0}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
