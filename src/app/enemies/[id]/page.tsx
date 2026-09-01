import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { enemyIconUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export default async function EnemyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data: enemy } = await supabase
    .from('enemies')
    .select('id, name, code, description, kind, rank, icon_sha1, wiki_href, raw')
    .eq('id', id)
    .maybeSingle()
  if (!enemy) notFound()

  const icon = enemyIconUrl(enemy.icon_sha1)
  // The infobox is kept whole in `raw`; show the fields worth reading rather
  // than dumping every balance stat.
  const raw = (enemy.raw ?? {}) as Record<string, string>
  const extras = ['伤害类型', '攻击方式', '行动方式', '登场活动'].filter(k => raw[k])

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />

      <div className="flex gap-5 items-start mb-8">
        {icon && (
          <span className="shrink-0 w-28 h-28 border border-ark-border bg-ark-surface
                           flex items-center justify-center overflow-hidden">
            <Image src={icon} alt={enemy.name} width={112} height={112} className="object-contain w-full h-full" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-light tracking-widest text-ark-text">{enemy.name}</h1>
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mt-1">
            {'// ENEMY'}
            {enemy.code && ` · ${enemy.code}`}
            {enemy.rank && ` · ${enemy.rank}`}
            {enemy.kind && ` · ${enemy.kind}`}
          </p>
        </div>
      </div>

      {enemy.description && (
        <section className="border border-ark-border p-4 mb-6">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-2">{'//'} 描述</p>
          <p className="text-sm text-ark-text leading-relaxed whitespace-pre-wrap">{enemy.description}</p>
        </section>
      )}

      {extras.length > 0 && (
        <section className="border border-ark-border p-4 mb-6">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-2">{'//'} 资料</p>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {extras.map(k => (
              <div key={k} className="flex gap-2">
                <dt className="text-ark-muted shrink-0">{k}</dt>
                <dd className="text-ark-text">{raw[k]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="font-mono text-[10px] tracking-widest uppercase flex gap-4">
        <Link href="/enemies" className="text-ark-muted hover:text-ark-accent">{'// ← 敌人一览'}</Link>
        {enemy.wiki_href && (
          <a href={enemy.wiki_href} target="_blank" rel="noopener noreferrer nofollow"
             className="text-ark-muted hover:text-ark-accent">
            {'// PRTS →'}
          </a>
        )}
      </p>
    </div>
  )
}
