import Image from 'next/image'
import Link from 'next/link'

// Shared presentation for the flat global catalogs (037): 敌人 and 道具.
// They differ only in their data source and labels, so the search box, filter
// row and card grid live here rather than being written twice.
//
// Server component on purpose — like /world, the search and filters are a
// plain <form> and <Link>s, so the whole page works without client JS.

export interface CatalogEntry {
  id: number
  name: string
  /** Small line under the name — kind/rank for an enemy, category for an item. */
  sub?: string | null
  description?: string | null
  iconUrl?: string | null
  href: string
}

export function CatalogSearch({
  action, q, placeholder,
}: {
  action: string
  q?: string
  placeholder: string
}) {
  return (
    <form className="flex gap-2 mb-6" action={action}>
      <input
        name="q"
        defaultValue={q ?? ''}
        placeholder={placeholder}
        className="flex-1 bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                   placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
      />
      <button className="font-mono text-[10px] tracking-widest uppercase px-3 border border-ark-accent
                         text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
        搜索
      </button>
    </form>
  )
}

export function CatalogFilters({
  base, current, values, labels = {}, param = 'kind',
}: {
  base: string
  current?: string
  values: string[]
  labels?: Record<string, string>
  param?: string
}) {
  if (values.length < 2) return null
  return (
    <div className="flex gap-x-3 gap-y-1.5 flex-wrap mb-6 font-mono text-[10px] tracking-widest uppercase">
      <Link href={base} className={!current ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}>
        全部
      </Link>
      {values.map(v => (
        <Link
          key={v}
          href={`${base}?${param}=${encodeURIComponent(v)}`}
          className={current === v ? 'text-ark-accent' : 'text-ark-muted hover:text-ark-accent'}
        >
          {labels[v] ?? v}
        </Link>
      ))}
    </div>
  )
}

export default function CatalogList({ entries }: { entries: CatalogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="font-mono text-[10px] text-ark-border tracking-widest uppercase">
        {'//'} 没有匹配的条目
      </p>
    )
  }
  return (
    <ul className="grid sm:grid-cols-2 gap-3">
      {entries.map(e => (
        <li key={e.id}>
          <Link
            href={e.href}
            className="flex gap-3 border border-ark-border p-3 h-full
                       hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors"
          >
            {/* Fixed box so a missing icon doesn't reflow the row. Images are
                unoptimized (next.config) and served straight from R2. */}
            <span className="shrink-0 w-12 h-12 border border-ark-border/60 bg-ark-surface
                             flex items-center justify-center overflow-hidden">
              {e.iconUrl ? (
                <Image src={e.iconUrl} alt="" width={48} height={48} className="object-contain w-full h-full" />
              ) : (
                <span className="font-mono text-[9px] text-ark-border">N/A</span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-ark-text truncate">{e.name}</span>
              {e.sub && (
                <span className="block font-mono text-[10px] text-ark-muted tracking-widest uppercase mt-0.5">
                  {'//'} {e.sub}
                </span>
              )}
              {e.description && (
                <span className="block text-xs text-ark-muted mt-1 line-clamp-2 leading-relaxed">
                  {e.description}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
