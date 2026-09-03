import { createClient } from '@/lib/supabase/server'
import { enemyIconUrl } from '@/lib/storage'
import CatalogList, { CatalogFilters, CatalogPager, CatalogSearch } from '@/components/CatalogList'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 60

interface Props {
  searchParams: Promise<{ q?: string; rank?: string; kind?: string; debut?: string; page?: string }>
}

export default async function EnemiesPage({ searchParams }: Props) {
  const sp = await searchParams
  const { q, rank, kind, debut } = sp
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const supabase = await createClient()

  // `count: 'exact'` gives the filtered total in the same round trip, which is
  // what the pager needs — there are 1780 enemies, so paging isn't optional.
  let query = supabase
    .from('enemies')
    .select('id, name, code, description, kind, rank, debut, icon_sha1', { count: 'exact' })
    .order('seq', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  // Search name AND description: people look an enemy up by what it does at
  // least as often as by what it's called.
  if (q?.trim()) {
    const t = q.trim().replace(/[(),]/g, ' ')
    query = query.or(`name.ilike.%${t}%,description.ilike.%${t}%`)
  }
  if (rank) query = query.eq('rank', rank)
  if (kind) query = query.eq('kind', kind)
  if (debut) query = query.eq('debut', debut)
  const { data: enemies, count } = await query

  const rows = enemies ?? []
  const total = count ?? rows.length

  // 地位级别 is the primary filter: 3 values covering 99% of the catalog
  // (普通 803 / 精英 718 / 领袖 243). 种类 is secondary because it's null on
  // 1131 of 1780 rows, so filtering by it hides most of the catalog.
  const RANKS = ['普通', '精英', '领袖']
  const { data: kindRows } = await supabase
    .from('enemies').select('kind').not('kind', 'is', null).limit(2000)
  const kinds = [...new Set((kindRows ?? []).map(r => r.kind as string))].sort()
  // 登场活动 is on every enemy and is the way people actually look one up
  // ("what was in this event"), but 102 values is a dropdown, not a chip row.
  const { data: debutRows } = await supabase
    .from('enemies').select('debut').not('debut', 'is', null).limit(2000)
  const debuts = [...new Set((debutRows ?? []).map(r => r.debut as string))].sort()

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">敌人图鉴</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// ENEMIES · '}{total.toString().padStart(4, '0')}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      <CatalogSearch action="/enemies" q={q} placeholder="搜索敌人名称或描述…" />
      <CatalogFilters base="/enemies" current={rank} values={RANKS} param="rank" />
      <CatalogFilters base="/enemies" current={kind} values={kinds} param="kind" />

      {/* GET form so the event filter works without JS, like the search box */}
      <form action="/enemies" className="flex gap-2 mb-6">
        {q && <input type="hidden" name="q" value={q} />}
        {rank && <input type="hidden" name="rank" value={rank} />}
        {kind && <input type="hidden" name="kind" value={kind} />}
        <select
          name="debut" defaultValue={debut ?? ''}
          className="flex-1 bg-ark-surface border border-ark-border px-2 py-1.5 text-sm text-ark-text
                     outline-none focus:border-ark-accent-dim"
        >
          <option value="">全部登场活动</option>
          {debuts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="font-mono text-[10px] tracking-widest uppercase px-3 border border-ark-border
                           text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim transition-colors">
          筛选
        </button>
      </form>

      <CatalogList
        entries={rows.map(e => ({
          id: e.id,
          name: e.name,
          sub: [e.code, e.rank, e.kind, e.debut].filter(Boolean).join(' · ') || null,
          description: e.description,
          iconUrl: enemyIconUrl(e.icon_sha1),
          href: `/enemies/${e.id}`,
        }))}
      />

      <CatalogPager
        base="/enemies" page={page} pageSize={PAGE_SIZE} total={total}
        params={{ q, rank, kind, debut }}
      />
    </div>
  )
}
