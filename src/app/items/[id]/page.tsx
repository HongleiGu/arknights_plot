import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { itemIconUrl } from '@/lib/storage'
import { CatalogIcon } from '@/components/CatalogList'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data: item } = await supabase
    .from('items')
    .select('id, name, description, usage_text, obtain_method, rarity, category, icon_sha1, wiki_href')
    .eq('id', id)
    .maybeSingle()
  if (!item) notFound()

  const icon = itemIconUrl(item.icon_sha1)
  const facts: [string, string | null][] = [
    ['用途', item.usage_text],
    ['获得方式', item.obtain_method],
    ['分类', item.category],
    ['稀有度', item.rarity != null ? `★${item.rarity}` : null],
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />

      <div className="flex gap-5 items-start mb-8">
        <CatalogIcon url={icon} alt={item.name} size={96} />
        <div className="min-w-0">
          <h1 className="text-2xl font-light tracking-widest text-ark-text">{item.name}</h1>
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mt-1">
            {'// ITEM'}
            {item.rarity != null && ` · ★${item.rarity}`}
            {item.category && ` · ${item.category}`}
          </p>
        </div>
      </div>

      {item.description && (
        <section className="border border-ark-border p-4 mb-6">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-2">{'//'} 描述</p>
          <p className="text-sm text-ark-text leading-relaxed whitespace-pre-wrap">{item.description}</p>
        </section>
      )}

      {facts.some(([, v]) => v) && (
        <section className="border border-ark-border p-4 mb-6">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-2">{'//'} 资料</p>
          <dl className="space-y-1.5 text-sm">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-ark-muted shrink-0 w-20">{k}</dt>
                <dd className="text-ark-text">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="font-mono text-[10px] tracking-widest uppercase flex gap-4">
        <Link href="/items" className="text-ark-muted hover:text-ark-accent">{'// ← 道具一览'}</Link>
        {item.wiki_href && (
          <a href={item.wiki_href} target="_blank" rel="noopener noreferrer nofollow"
             className="text-ark-muted hover:text-ark-accent">
            {'// PRTS →'}
          </a>
        )}
      </p>
    </div>
  )
}
