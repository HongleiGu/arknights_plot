import { createClient } from '@/lib/supabase/server'
import { itemIconUrl } from '@/lib/storage'
import CatalogList, { CatalogFilters, CatalogSearch } from '@/components/CatalogList'

export const dynamic = 'force-dynamic'

const PAGE = 120

interface Props {
  searchParams: Promise<{ q?: string; category?: string }>
}

export default async function ItemsPage({ searchParams }: Props) {
  const { q, category } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('items')
    .select('id, name, description, usage_text, obtain_method, rarity, category, icon_sha1')
    .order('rarity', { ascending: false })
    .order('seq', { ascending: true })
    .limit(PAGE)
  if (q?.trim()) {
    const t = q.trim().replace(/[(),]/g, ' ')
    query = query.or(`name.ilike.%${t}%,description.ilike.%${t}%`)
  }
  if (category) query = query.eq('category', category)
  const { data: items } = await query

  const { data: catRows } = await supabase.from('items').select('category').limit(2000)
  const categories = [...new Set((catRows ?? []).map(r => r.category).filter(Boolean) as string[])].sort()

  const rows = items ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">道具</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// ITEMS · '}{rows.length.toString().padStart(3, '0')}
        {rows.length === PAGE ? '+' : ''}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      <CatalogSearch action="/items" q={q} placeholder="搜索道具名称或描述…" />
      <CatalogFilters base="/items" current={category} values={categories} param="category" />

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
    </div>
  )
}
