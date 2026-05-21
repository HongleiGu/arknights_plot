import Link from 'next/link'

export interface EventListItem {
  id: number
  category: string | null
  name: string | null
  name_en: string | null
  intro: string | null
  seq: number | null
}

/**
 * 集成战略 event index, grouped by `category` (the wiki section: 不期而遇 /
 * 传说 / …). Each card links into the event reader.
 */
export default function EventList({
  events,
  encodedCategory,
  encodedStory,
  id,
}: {
  events: EventListItem[]
  encodedCategory: string
  encodedStory: string
  id?: string
}) {
  if (events.length === 0) return null

  const groups = new Map<string, EventListItem[]>()
  for (const e of events) {
    const k = e.category ?? '—'
    const arr = groups.get(k) ?? []
    arr.push(e)
    groups.set(k, arr)
  }

  return (
    <section id={id} className="mt-16 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
        <span className="text-ark-accent">{'//'}</span> EVENTS{' '}
        <span className="text-ark-border">·</span> 事件{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">{events.length.toString().padStart(3, '0')}</span>
      </p>

      <div className="space-y-10 mt-6">
        {[...groups.entries()].map(([section, items]) => (
          <div key={section}>
            <p className="font-mono text-[11px] text-ark-accent tracking-widest uppercase mb-3">
              {section} <span className="text-ark-border">·</span>{' '}
              <span className="text-ark-muted">
                {items.length.toString().padStart(2, '0')}
              </span>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map(e => (
                <Link
                  key={e.id}
                  href={`/${encodedCategory}/${encodedStory}/event/${e.id}`}
                  className="group block border border-ark-border bg-ark-surface p-4
                             hover:border-ark-accent transition-colors"
                >
                  <p className="text-sm text-ark-text group-hover:text-ark-accent-bright
                                transition-colors">
                    {e.name ?? `#${e.id}`}
                  </p>
                  {e.intro && (
                    <p className="mt-1.5 text-xs text-ark-muted leading-relaxed
                                  line-clamp-2">
                      {e.intro}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
