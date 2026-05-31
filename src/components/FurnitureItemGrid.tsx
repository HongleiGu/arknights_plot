'use client'

import Image from 'next/image'
import { furnitureIconUrl } from '@/lib/storage'
import CommentThread from '@/components/CommentThread'

export interface FurnitureItem {
  id: number
  name: string
  wiki_href: string | null
  description: string | null
  atmo_value: number | null
  icon_sha1: string | null
  seq: number
  // Theme-level metadata (present on themed items; null for standalone)
  atmo_total?: number | null
  date_added?: string | null
  acquisition?: string | null
}

export default function FurnitureItemGrid({
  items,
  id,
  labelEn = 'PIECES',
  labelCn = '家具',
}: {
  items: FurnitureItem[]
  id?: string
  labelEn?: string
  labelCn?: string
}) {
  if (items.length === 0) return null

  return (
    <section id={id} className="mt-10 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
        <span className="text-ark-accent">{'//'}</span> {labelEn}{' '}
        <span className="text-ark-border">·</span> {labelCn}{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">{items.length.toString().padStart(3, '0')}</span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(item => (
          <FurnitureCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}


function FurnitureCard({ item }: { item: FurnitureItem }) {
  const icon = furnitureIconUrl(item.icon_sha1)
  return (
    <div className="border border-ark-border bg-ark-surface p-3
                    hover:border-ark-accent/50 transition-colors">
      <div className="flex gap-3">
        {/* Icon */}
        <div className="relative shrink-0 w-14 h-14 bg-ark-bg border border-ark-border">
          {icon ? (
            <Image
              src={icon}
              alt={item.name}
              fill
              sizes="56px"
              className="object-contain p-1"
            />
          ) : (
            <div className="absolute inset-0 opacity-[0.15]"
                 style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
          )}
        </div>

        {/* Name + description */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-ark-text leading-snug">{item.name}</p>
            {item.atmo_value != null && (
              <span className="shrink-0 font-mono text-[10px] text-ark-accent tracking-wider">
                +{item.atmo_value}
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-1.5 text-xs text-ark-muted leading-relaxed whitespace-pre-wrap">
              {item.description}
            </p>
          )}
        </div>
      </div>
      <CommentThread anchor={{ furniture_item_id: item.id }} initialCount={0} />
    </div>
  )
}
