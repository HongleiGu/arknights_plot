import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EventTree, { type OptionNode } from '@/components/EventTree'

interface Props {
  params: Promise<{ category: string; story: string; event: string }>
}

interface OptionRow {
  id: number
  parent_option_id: number | null
  seq: number
  label: string | null
  description: string | null
  predicate: string | null
  note: string | null
  outcome: string | null
}

export default async function EventPage({ params }: Props) {
  const { category: encCategory, story: encStory, event: eventIdStr } = await params
  const category  = decodeURIComponent(encCategory)
  const storyName = decodeURIComponent(encStory)
  const eventId   = parseInt(eventIdStr, 10)

  if (Number.isNaN(eventId)) notFound()

  const supabase = await createClient()

  // ---- 1. Resolve event + verify it belongs to (category, story) ----
  const { data: event, error: evErr } = await supabase
    .from('events')
    .select(`
      id, category, name, name_en, intro,
      stories ( name, category )
    `)
    .eq('id', eventId)
    .maybeSingle()

  if (evErr || !event) notFound()

  const parent = Array.isArray(event.stories) ? event.stories[0] : event.stories
  if (!parent || parent.category !== category || parent.name !== storyName) {
    notFound()
  }

  // ---- 2. The whole option tree (one query) ----
  const { data: opts } = await supabase
    .from('event_options')
    .select('id, parent_option_id, seq, label, description, predicate, note, outcome')
    .eq('event_id', eventId)
    .order('seq')

  const rows = (opts ?? []) as OptionRow[]

  // ---- 3. Per-option comment counts (one query) ----
  const commentCounts = new Map<number, number>()
  if (rows.length) {
    const { data: anchors } = await supabase
      .from('comment_anchors')
      .select('event_option_id')
      .in('event_option_id', rows.map(r => r.id))
    for (const a of anchors ?? []) {
      const k = a.event_option_id as number
      commentCounts.set(k, (commentCounts.get(k) ?? 0) + 1)
    }
  }

  // ---- 4. Rows → serializable tree (parent_option_id → children) ----
  const childrenOf = new Map<number | null, OptionRow[]>()
  for (const r of rows) {
    const arr = childrenOf.get(r.parent_option_id) ?? []
    arr.push(r)
    childrenOf.set(r.parent_option_id, arr)
  }
  const build = (parentId: number | null): OptionNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort((a, b) => a.seq - b.seq)
      .map(r => ({
        id: r.id,
        seq: r.seq,
        label: r.label,
        description: r.description,
        predicate: r.predicate,
        note: r.note,
        outcome: r.outcome,
        commentCount: commentCounts.get(r.id) ?? 0,
        options: build(r.id),
      }))
  const tree = build(null)

  return (
    <div className="min-h-[calc(100vh-3.5rem-1.75rem)] flex flex-col">
      {/* Faint background grid — same vibe as the chapter reader */}
      <div className="fixed inset-0 -z-10 bg-ark-bg">
        <div className="absolute inset-0 opacity-[0.025]"
             style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 font-mono text-[11px] text-ark-muted tracking-widest uppercase flex-wrap">
          <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encCategory}`} className="hover:text-ark-accent transition-colors">
            {category}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encCategory}/${encStory}`} className="hover:text-ark-accent transition-colors">
            {storyName}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <span className="text-ark-accent normal-case">{event.name ?? `#${event.id}`}</span>
        </div>

        {/* Title */}
        <div className="mb-8">
          <div className="h-0.5 w-8 bg-ark-accent mb-4" />
          <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
            <span className="text-ark-accent">{'//'}</span> EVENT
            {event.category && (
              <> <span className="text-ark-border">·</span> {event.category}</>
            )}
          </p>
          <h1 className="text-2xl sm:text-3xl font-light tracking-wider text-ark-text">
            {event.name ?? `#${event.id}`}
          </h1>
        </div>

        <EventTree intro={event.intro} options={tree} />
      </div>
    </div>
  )
}
