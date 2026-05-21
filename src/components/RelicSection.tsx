'use client'

import Image from 'next/image'
import { gadgetIconUrl } from '@/lib/storage'
import CommentThread from '@/components/CommentThread'

export interface Relic {
  id: number
  kind: string
  name: string
  name_en: string | null
  description: string | null
  effect: string | null
  icon_sha1: string | null
  seq: number | null
}

export default function RelicSection({
  relics,
  id,
  labelEn = 'RELICS',
  labelCn = '藏品',
}: {
  relics: Relic[]
  id?: string
  labelEn?: string
  labelCn?: string
}) {
  if (relics.length === 0) return null

  const groups = new Map<string, Relic[]>()
  for (const r of relics) {
    const arr = groups.get(r.kind) ?? []
    arr.push(r)
    groups.set(r.kind, arr)
  }

  return (
    <section id={id} className="mt-16 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
        <span className="text-ark-accent">{'//'}</span> {labelEn}{' '}
        <span className="text-ark-border">·</span> {labelCn}{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">{relics.length.toString().padStart(3, '0')}</span>
      </p>

      <div className="space-y-10 mt-6">
        {[...groups.entries()].map(([kind, items]) => (
          <div key={kind}>
            <p className="font-mono text-[11px] text-ark-accent tracking-widest uppercase mb-3">
              {kind} <span className="text-ark-border">·</span>{' '}
              <span className="text-ark-muted">
                {items.length.toString().padStart(2, '0')}
              </span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(r => (
                <RelicCard key={r.id} relic={r} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RelicCard({ relic }: { relic: Relic }) {
  const icon = gadgetIconUrl(relic.icon_sha1)
  return (
    <div className="border border-ark-border bg-ark-surface p-3
                    hover:border-ark-accent/50 transition-colors">
      <div className="flex gap-3">
        <div className="relative shrink-0 w-14 h-14 bg-ark-bg border border-ark-border">
          {icon ? (
            <Image
              src={icon}
              alt={relic.name}
              fill
              sizes="56px"
              className="object-contain p-1"
            />
          ) : (
            <div className="absolute inset-0 opacity-[0.15]"
                 style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ark-text leading-snug">{relic.name}</p>
          {relic.effect && (
            <p className="mt-1 text-xs text-ark-accent leading-relaxed whitespace-pre-wrap">
              {relic.effect}
            </p>
          )}
          {relic.description && (
            <p className="mt-1 text-xs text-ark-muted leading-relaxed whitespace-pre-wrap">
              {relic.description}
            </p>
          )}
        </div>
      </div>
      <CommentThread anchor={{ gadget_id: relic.id }} initialCount={0} />
    </div>
  )
}
