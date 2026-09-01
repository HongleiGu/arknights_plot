import { createClient } from '@/lib/supabase/server'
import { enemyIconUrl } from '@/lib/storage'
import CatalogList, { CatalogFilters, CatalogSearch } from '@/components/CatalogList'

export const dynamic = 'force-dynamic'

const PAGE = 120

interface Props {
  searchParams: Promise<{ q?: string; kind?: string }>
}

export default async function EnemiesPage({ searchParams }: Props) {
  const { q, kind } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('enemies')
    .select('id, name, code, description, kind, rank, icon_sha1')
    .order('seq', { ascending: true })
    .limit(PAGE)
  // Search name AND description: people look an enemy up by what it does at
  // least as often as by what it's called.
  if (q?.trim()) {
    const t = q.trim().replace(/[(),]/g, ' ')
    query = query.or(`name.ilike.%${t}%,description.ilike.%${t}%`)
  }
  if (kind) query = query.eq('kind', kind)
  const { data: enemies } = await query

  // Distinct kinds for the filter row. Cheap: a few hundred short strings.
  const { data: kindRows } = await supabase.from('enemies').select('kind').limit(1000)
  const kinds = [...new Set((kindRows ?? []).map(r => r.kind).filter(Boolean) as string[])].sort()

  const rows = enemies ?? []

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">敌人</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// ENEMIES · '}{rows.length.toString().padStart(3, '0')}
        {rows.length === PAGE ? '+' : ''}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      <CatalogSearch action="/enemies" q={q} placeholder="搜索敌人名称或描述…" />
      <CatalogFilters base="/enemies" current={kind} values={kinds} param="kind" />

      <CatalogList
        entries={rows.map(e => ({
          id: e.id,
          name: e.name,
          sub: [e.code, e.rank, e.kind].filter(Boolean).join(' · ') || null,
          description: e.description,
          iconUrl: enemyIconUrl(e.icon_sha1),
          href: `/enemies/${e.id}`,
        }))}
      />
    </div>
  )
}
