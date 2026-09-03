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

/**
 * Icon, or a placeholder when there isn't one.
 *
 * ~2.5% of enemies genuinely have no portrait on the wiki — they're collection
 * pages, disambiguation pages, or story props that were never drawn — so this
 * is a permanent state, not a loading gap, and it shouldn't read as breakage.
 * The rhomboid is the operator-class mark from the header, so an empty slot
 * still looks like part of the HUD rather than a missing image.
 */
export function CatalogIcon({
  url, alt, size = 48,
}: {
  url?: string | null
  alt?: string
  size?: number
}) {
  return (
    <span
      className="shrink-0 border border-ark-border/60 bg-ark-surface
                 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
      // Only announce the placeholder; a real icon is decorative next to its label.
      title={url ? undefined : '暂无图像'}
    >
      {url ? (
        <Image src={url} alt={alt ?? ''} width={size} height={size}
               className="object-contain w-full h-full" />
      ) : (
        <span
          className="block bg-ark-border/70"
          style={{
            width: Math.round(size * 0.3),
            height: Math.round(size * 0.3),
            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          }}
          aria-hidden
        />
      )}
    </span>
  )
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

/**
 * Page links. Server-rendered <Link>s, like the search form — the catalogs
 * work with JS off, and this keeps that true.
 *
 * Necessary rather than nice-to-have: there are 1780 enemies and 1359 items,
 * so a fixed 120-row cap showed 7% and 9% of them with no way to reach the
 * rest.
 *
 * Windowed to keep the row short at 15 pages, always including first/last so
 * the ends are one click away.
 */
export function CatalogPager({
  base, page, pageSize, total, params = {},
}: {
  base: string
  page: number
  pageSize: number
  total: number
  params?: Record<string, string | undefined>
}) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null

  const href = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
    if (p > 1) q.set('page', String(p))
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }

  const span = 2
  const nums = new Set<number>([1, pages])
  for (let p = page - span; p <= page + span; p++) if (p >= 1 && p <= pages) nums.add(p)
  const ordered = [...nums].sort((a, b) => a - b)

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <nav className="mt-8 font-mono text-[10px] tracking-widest uppercase" aria-label="分页">
      <p className="text-ark-border mb-2">{'//'} {from}–{to} / {total}</p>
      <div className="flex gap-x-2 gap-y-1.5 flex-wrap items-center">
        {page > 1 && (
          <Link href={href(page - 1)} className="text-ark-muted hover:text-ark-accent">← 上一页</Link>
        )}
        {ordered.map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            {/* a gap in the sequence means pages were skipped */}
            {i > 0 && p - ordered[i - 1] > 1 && <span className="text-ark-border">…</span>}
            {p === page ? (
              <span className="text-ark-accent" aria-current="page">{p}</span>
            ) : (
              <Link href={href(p)} className="text-ark-muted hover:text-ark-accent">{p}</Link>
            )}
          </span>
        ))}
        {page < pages && (
          <Link href={href(page + 1)} className="text-ark-muted hover:text-ark-accent">下一页 →</Link>
        )}
      </div>
    </nav>
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
            <CatalogIcon url={e.iconUrl} size={48} />
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
