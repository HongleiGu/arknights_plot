import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { parseReferences, resolveReferences, type ReferenceData } from '@/lib/references'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 80

// Ordering is by `seq` — the source page's own order — not by (year, month,
// day). seq is total and already chronological; it spans the pre-Terra era,
// BC years, "12世纪（时间未知）" and the TT calendar, none of which sort
// numerically. year/month/day are for filtering and display only.
interface Row {
  id: number
  seq: number
  era: string | null
  section: string | null
  period: string | null
  date_label: string | null
  year: number | null
  precision: string
  approx: boolean
  description: string
  source_refs: string[]
}

interface Props {
  searchParams: Promise<{ q?: string; era?: string; page?: string }>
}

export default async function TimelinePage({ searchParams }: Props) {
  const sp = await searchParams
  const { q, era } = sp
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const supabase = await createClient()

  let query = supabase
    .from('timeline_events')
    .select('id, seq, era, section, period, date_label, year, precision, approx, description, source_refs',
            { count: 'exact' })
    .order('seq', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (q?.trim()) query = query.ilike('description', `%${q.trim()}%`)
  if (era) query = query.eq('section', era)
  const { data, count } = await query

  const rows = (data ?? []) as Row[]
  const total = count ?? rows.length

  // Section list for the filter row. 890 rows, so one scan is cheap and there
  // is no grouping query to add.
  const { data: sectionRows } = await supabase
    .from('timeline_events').select('section').not('section', 'is', null).limit(1000)
  const sections = [...new Set((sectionRows ?? []).map(s => s.section as string))]

  // Resolve every citation on this page in one batch.
  const refs = parseReferences(rows.flatMap(r => r.source_refs ?? []).join(' '))
  const resolved = await resolveReferences(supabase, refs)
  const byKey = new Map<string, ReferenceData>(resolved.map(r => [r.key, r]))

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ q, era, page, ...over })) {
      if (v !== undefined && v !== '' && !(k === 'page' && v === 1)) p.set(k, String(v))
    }
    const s = p.toString()
    return s ? `/timeline?${s}` : '/timeline'
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Period boundaries are derived up front rather than tracked with a mutable
  // cursor inside the map: reassigning across a render callback is exactly what
  // react-hooks/immutability forbids. Compared against the nearest *previous
  // non-null* period so a row with no period doesn't reopen the same heading.
  const items = rows.map((ev, i) => {
    let prev: string | null = null
    for (let j = i - 1; j >= 0; j--) {
      if (rows[j].period) { prev = rows[j].period; break }
    }
    return { ev, showPeriod: !!ev.period && ev.period !== prev }
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">泰拉年表</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-6">
        {'// TIMELINE · '}{total.toString().padStart(4, '0')}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      {/* The source's own disclaimer, kept prominent on purpose: every row is a
          community reading of the plot, not published setting. Presenting this
          as canon would be the one way to get this feature badly wrong. */}
      <p className="border-l-2 border-ark-accent-dim bg-ark-surface/40 px-3 py-2 mb-6
                    text-xs text-ark-muted leading-relaxed">
        以下时间均由玩家社区通过游戏内剧情<strong className="text-ark-text font-normal">推测</strong>，
        可能存在偏差。每条均附原文出处，请以出处为准。
        <a href="https://prts.wiki/w/%E6%B3%B0%E6%8B%89%E5%B9%B4%E8%A1%A8"
           target="_blank" rel="noopener noreferrer"
           className="ml-1 text-ark-accent hover:underline">来源：PRTS 泰拉年表 ↗</a>
      </p>

      <form className="flex gap-2 mb-4" action="/timeline">
        {era && <input type="hidden" name="era" value={era} />}
        <input
          name="q" defaultValue={q ?? ''} placeholder="搜索事件…"
          className="flex-1 bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                     placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
        />
        <button className="font-mono text-[10px] tracking-widest uppercase px-3 border border-ark-accent
                           text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
          搜索
        </button>
      </form>

      {sections.length > 1 && (
        <div className="flex gap-3 flex-wrap mb-8 font-mono text-[10px] tracking-widest uppercase">
          <Link href={qs({ era: undefined, page: 1 })}
                className={!era ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}>全部</Link>
          {sections.map(s => (
            <Link key={s} href={qs({ era: s, page: 1 })}
                  className={era === s ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}>
              {s}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <p className="font-mono text-[10px] text-ark-border tracking-widest">{'// 无结果'}</p>
      )}

      <ol className="relative">
        {items.map(({ ev, showPeriod }) => {
          const chips = (ev.source_refs ?? [])
            .map(t => byKey.get(t.replace(/^@/, '')))
            .filter((r): r is ReferenceData => !!r)
          return (
            <li key={ev.id} id={`e${ev.id}`}>
              {showPeriod && (
                <h2 className="font-mono text-[10px] text-ark-accent tracking-widest uppercase
                               mt-8 mb-3 pb-1 border-b border-ark-border">
                  {'// '}{ev.period}
                  {ev.era && <span className="text-ark-muted"> · {ev.era}</span>}
                </h2>
              )}
              <div className="flex gap-4 py-3 border-b border-ark-border/40">
                {/* Date column. `approx` is the source's own hedge — showing it
                    is the difference between a claim and an assertion. */}
                <div className="w-24 shrink-0 pt-0.5">
                  <span className="font-mono text-[11px] text-ark-muted leading-tight block">
                    {ev.approx && <span className="text-ark-border">约 </span>}
                    {ev.date_label || '—'}
                  </span>
                  {ev.precision === 'unknown' && (
                    <span className="font-mono text-[9px] text-ark-border">时间未知</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ark-text leading-relaxed whitespace-pre-line">
                    {ev.description}
                  </p>
                  {chips.length > 0 && (
                    <div className="flex gap-x-3 gap-y-1 flex-wrap mt-1.5">
                      {chips.map(c => c.href ? (
                        <Link key={c.key} href={c.href} title={c.preview ?? undefined}
                              className="font-mono text-[10px] text-ark-muted hover:text-ark-accent transition-colors">
                          {'▸ '}{c.label}
                        </Link>
                      ) : (
                        <span key={c.key} className="font-mono text-[10px] text-ark-border">
                          {'▸ '}{c.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* No resolvable citation is a real state (aggregate wiki
                      pages, operator dossiers we don't import) — say so rather
                      than rendering a row that looks sourced but isn't. */}
                  {chips.length === 0 && (
                    <span className="font-mono text-[10px] text-ark-border">{'// 无可跳转出处'}</span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {lastPage > 1 && (
        <div className="flex items-center justify-between mt-8 font-mono text-[10px] tracking-widest uppercase">
          {page > 1 ? (
            <Link href={qs({ page: page - 1 })} className="text-ark-muted hover:text-ark-accent">← 上一页</Link>
          ) : <span className="text-ark-border">← 上一页</span>}
          <span className="text-ark-muted">{page} / {lastPage}</span>
          {page < lastPage ? (
            <Link href={qs({ page: page + 1 })} className="text-ark-muted hover:text-ark-accent">下一页 →</Link>
          ) : <span className="text-ark-border">下一页 →</span>}
        </div>
      )}
    </div>
  )
}
