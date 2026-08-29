import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  character: '角色', location: '地点', faction: '势力', concept: '概念', artefact: '造物',
}

interface Props {
  searchParams: Promise<{ q?: string; type?: string }>
}

export default async function WorldPage({ searchParams }: Props) {
  const { q, type } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('entities')
    .select('id, name, type, summary, mention_count')
    .order('mention_count', { ascending: false })
    .limit(120)
  if (q?.trim()) query = query.ilike('name', `%${q.trim()}%`)
  if (type) query = query.eq('type', type)
  const { data: entities } = await query

  // Which types exist (for the filter row)
  const { data: typeRows } = await supabase.from('entities').select('type').limit(1000)
  const types = [...new Set((typeRows ?? []).map(t => t.type as string))].sort()

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">世界图谱</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// WORLD GRAPH · '}{(entities ?? []).length.toString().padStart(3, '0')}
        {q ? ` · 搜索「${q}」` : ''}
      </p>

      {/* search + type filter (plain form — no client JS needed) */}
      <form className="flex gap-2 mb-6" action="/world">
        <input
          name="q" defaultValue={q ?? ''} placeholder="搜索实体名称…"
          className="flex-1 bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                     placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
        />
        <button className="font-mono text-[10px] tracking-widest uppercase px-3 border border-ark-accent
                           text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
          搜索
        </button>
      </form>

      {types.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-6 font-mono text-[10px] tracking-widest uppercase">
          <Link href="/world" className={!type ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}>全部</Link>
          {types.map(t => (
            <Link key={t} href={`/world?type=${encodeURIComponent(t)}`}
                  className={type === t ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}>
              {TYPE_LABEL[t] ?? t}
            </Link>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {(entities ?? []).map(e => (
          <li key={e.id}>
            <Link href={`/world/${e.id}`}
                  className="block border border-ark-border p-3 hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors">
              <p className="text-sm text-ark-text">
                {e.name}
                <span className="font-mono text-[10px] text-ark-muted ml-2 tracking-widest uppercase">
                  {TYPE_LABEL[e.type] ?? e.type}
                </span>
              </p>
              {e.summary && <p className="text-xs text-ark-muted mt-1 line-clamp-2">{e.summary}</p>}
              <p className="font-mono text-[10px] text-ark-border tracking-widest mt-1">
                {'//'} {e.mention_count} 次出场
              </p>
            </Link>
          </li>
        ))}
        {(entities ?? []).length === 0 && (
          <li className="font-mono text-[10px] text-ark-border tracking-widest">{'// 没有匹配的实体'}</li>
        )}
      </ul>
    </div>
  )
}
