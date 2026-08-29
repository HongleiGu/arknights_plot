import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  character: '角色', location: '地点', faction: '势力', concept: '概念', artefact: '造物',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function EntityPage({ params }: Props) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data: entity } = await supabase
    .from('entities')
    .select('id, type, name, name_en, aliases, summary, summary_status, mention_count, source_url')
    .eq('id', id)
    .maybeSingle()
  if (!entity) notFound()

  // Direct relations (undirected: this entity on either side), with the other end resolved.
  const { data: edges } = await supabase
    .from('entity_relations')
    .select('id, from_entity_id, to_entity_id, kind, note, source, source_refs')
    .or(`from_entity_id.eq.${id},to_entity_id.eq.${id}`)
  const otherIds = [...new Set((edges ?? []).map(e => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id)))]
  const { data: others } = otherIds.length
    ? await supabase.from('entities').select('id, name, type').in('id', otherIds)
    : { data: [] }
  const otherById = new Map((others ?? []).map(o => [o.id as number, o]))

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 mb-6 font-mono text-[11px] text-ark-muted tracking-widest uppercase">
        <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
        <span className="text-ark-border">{'//'}</span>
        <Link href="/world" className="hover:text-ark-accent transition-colors">世界图谱</Link>
        <span className="text-ark-border">{'//'}</span>
        <span className="text-ark-accent normal-case">{entity.name}</span>
      </div>

      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
        <span className="text-ark-accent">{'//'}</span> {TYPE_LABEL[entity.type] ?? entity.type}
        <span className="text-ark-border"> · </span>entity/{entity.id}
      </p>
      <h1 className="text-2xl sm:text-3xl font-light tracking-wider text-ark-text">
        {entity.name}
        {entity.name_en && <span className="text-ark-muted text-lg ml-3">{entity.name_en}</span>}
      </h1>
      <p className="font-mono text-[10px] text-ark-muted mt-3 tracking-widest uppercase">
        <span className="text-ark-accent">{'//'}</span>{' '}
        <span className="text-ark-text">{entity.mention_count}</span> 次出场
        {(entity.aliases ?? []).length > 0 && (
          <>
            <span className="text-ark-border"> · </span>别名 {(entity.aliases as string[]).join('、')}
          </>
        )}
      </p>

      {entity.summary && (
        <p className="text-sm leading-relaxed text-ark-text/90 mt-5 border-l-2 border-ark-accent/40 pl-4">
          {entity.summary}
        </p>
      )}

      {/* relations */}
      <section className="mt-10">
        <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-4">
          <span className="text-ark-accent">{'//'}</span> RELATIONS{' '}
          <span className="text-ark-border">·</span> 关系{' '}
          <span className="text-ark-border">·</span>{' '}
          <span className="text-ark-text">{(edges ?? []).length.toString().padStart(2, '0')}</span>
        </p>

        {(edges ?? []).length === 0 ? (
          <p className="font-mono text-[10px] text-ark-border tracking-widest">
            {'// 尚未抽取该实体的关系（在 /admin/ai 运行关系抽取）'}
          </p>
        ) : (
          <ul className="space-y-2">
            {(edges ?? []).map(e => {
              const outgoing = e.from_entity_id === id
              const other = otherById.get(outgoing ? e.to_entity_id : e.from_entity_id)
              return (
                <li key={e.id} className="border border-ark-border p-3">
                  <p className="text-sm text-ark-text flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-ark-accent tracking-widest uppercase">
                      {outgoing ? '→' : '←'} {e.kind}
                    </span>
                    {other
                      ? <Link href={`/world/${other.id}`} className="text-ark-accent hover:text-ark-accent-bright underline underline-offset-2">{other.name}</Link>
                      : <span className="text-ark-muted">#{outgoing ? e.to_entity_id : e.from_entity_id}</span>}
                  </p>
                  {e.note && <p className="text-xs text-ark-muted mt-1 leading-relaxed">{e.note}</p>}
                  <p className="font-mono text-[10px] text-ark-border tracking-widest mt-1.5">
                    {'//'} {e.source ?? 'ai'}
                    {(e.source_refs ?? []).length > 0 && <> · 来源 {(e.source_refs as string[]).join(' ')}</>}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
