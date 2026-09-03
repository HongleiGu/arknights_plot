import { createClient } from '@/lib/supabase/server'
import { itemIconUrl } from '@/lib/storage'
import CatalogList, { CatalogFilters, CatalogPager, CatalogSearch } from '@/components/CatalogList'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 60

interface Props {
  searchParams: Promise<{ q?: string; rarity?: string; category?: string; page?: string }>
}

export default async function ItemsPage({ searchParams }: Props) {
  const sp = await searchParams
  const { q, rarity, category } = sp
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const supabase = await createClient()

  let query = supabase
    .from('items')
    .select('id, name, description, usage_text, obtain_method, rarity, category, icon_sha1',
            { count: 'exact' })
    .order('rarity', { ascending: false })
    .order('seq', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (q?.trim()) {
    const t = q.trim().replace(/[(),]/g, ' ')
    query = query.or(`name.ilike.%${t}%,description.ilike.%${t}%`)
  }
  if (rarity) query = query.eq('rarity', Number(rarity))
  if (category) query = query.eq('category', category)
  const { data: items, count } = await query

  const rows = items ?? []
  const total = count ?? rows.length

  // Rarity is the primary filter: complete on every row and only six values.
  // Category has 37 distinct values (420 of them 信物), which is a wall of
  // links rather than a filter — so it's a <select> instead of chips.
  const RARITIES = ['5', '4', '3', '2', '1', '0']
  const { data: catRows } = await supabase
    .from('items').select('category').not('category', 'is', null).limit(2000)
  const categories = [...new Set((catRows ?? []).map(r => r.category as string))].sort()

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">道具图鉴</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// ITEMS · '}{total.toString().padStart(4, '0')}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      <CatalogSearch action="/items" q={q} placeholder="搜索道具名称或描述…" />
      <CatalogFilters
        base="/items" current={rarity} values={RARITIES} param="rarity"
        labels={Object.fromEntries(RARITIES.map(r => [r, `★${r}`]))}
      />

      {/* 37 categories — a dropdown, and a GET form so it still works without JS */}
      <form action="/items" className="flex gap-2 mb-6">
        {q && <input type="hidden" name="q" value={q} />}
        {rarity && <input type="hidden" name="rarity" value={rarity} />}
        <select
          name="category" defaultValue={category ?? ''}
          className="flex-1 bg-ark-surface border border-ark-border px-2 py-1.5 text-sm text-ark-text
                     outline-none focus:border-ark-accent-dim"
        >
          <option value="">全部分类</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="font-mono text-[10px] tracking-widest uppercase px-3 border border-ark-border
                           text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim transition-colors">
          筛选
        </button>
      </form>

      <CatalogList
        entries={rows.map(i => ({
          id: i.id,
          name: i.name,
          sub: [i.rarity != null ? `★${i.rarity}` : null, i.category].filter(Boolean).join(' · ') || null,
          description: i.description ?? i.usage_text,
          iconUrl: itemIconUrl(i.icon_sha1),
          href: `/items/${i.id}`,
        }))}
      />

      <CatalogPager
        base="/items" page={page} pageSize={PAGE_SIZE} total={total}
        params={{ q, rarity, category }}
      />
    </div>
  )
}
