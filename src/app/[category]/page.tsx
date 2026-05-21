import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CategoryBrowser from '@/components/CategoryBrowser'
import { storyImageUrl } from '@/lib/storage'

interface Props {
  params: Promise<{ category: string }>
}

// ---- Main story grid (主线) --------------------------------------------------
export type StoryListItem = {
  name: string
  description: string | null
  icon_sha1: string | null
  title_sha1: string | null
  cover_sha1: string | null
  count: number
}

function MainlineGrid({
  stories,
  encodedCategory,
}: {
  stories: StoryListItem[]
  encodedCategory: string
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-ark-border">
      {stories.map((s, i) => {
        // 主线 cards: prefer cover, fall back to title.
        const imgUrl = storyImageUrl('cover', s.cover_sha1)
                     ?? storyImageUrl('title', s.title_sha1)
        return (
          <Link
            key={s.name}
            href={`/${encodedCategory}/${encodeURIComponent(s.name)}`}
            className="group relative aspect-[16/10] overflow-hidden bg-ark-surface cursor-crosshair"
          >
            {/* Cover image */}
            {imgUrl ? (
              <Image
                src={imgUrl}
                alt={s.name}
                fill
                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                className="object-contain p-2 opacity-80 group-hover:opacity-100 group-hover:scale-[1.02]
                           transition-all duration-500"
              />
            ) : (
              /* Placeholder grid */
              <div className="absolute inset-0 opacity-[0.06]"
                   style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
            )}

            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-ark-bg via-ark-bg/40 to-transparent" />

            {/* Hover: crosshair cursor icon drawn via CSS */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0
                            group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              <div className="relative w-8 h-8">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-ark-accent -translate-y-px" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-ark-accent -translate-x-px" />
                <div className="absolute inset-1 border border-ark-accent/50" />
              </div>
            </div>

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-3">
              <p className="text-[10px] text-ark-muted mb-0.5 tracking-widest">
                {(i + 1).toString().padStart(2, '0')}
              </p>
              <p className="text-sm font-light text-ark-text tracking-wide leading-snug
                            group-hover:text-ark-accent-bright transition-colors duration-300">
                {s.name}
              </p>
              <p className="text-[10px] text-ark-muted mt-1">{s.count} 个章节</p>
            </div>

            {/* Corner accent */}
            <div className="absolute top-0 right-0 w-0 h-0 border-t-[20px] border-r-[20px]
                            border-t-transparent border-r-ark-accent/30
                            group-hover:border-r-ark-accent transition-colors duration-300" />
          </Link>
        )
      })}
    </div>
  )
}

// ---- Page -------------------------------------------------------------------
export default async function CategoryPage({ params }: Props) {
  const { category: encodedCategory } = await params
  const category = decodeURIComponent(encodedCategory)

  const supabase = await createClient()

  // Stories in this category (one row per arc/album/run).
  const { data: storyRows, error } = await supabase
    .from('stories')
    .select('id, name, name_en, description, icon_sha1, title_sha1, cover_sha1, seq')
    .eq('category', category)
    .order('seq', { ascending: true, nullsFirst: false })
    .order('id')

  if (error) {
    console.error('[CategoryPage] stories query error:', error)
    notFound()
  }
  if (!storyRows?.length) {
    console.error('[CategoryPage] no stories found for category:', category)
    notFound()
  }

  // Chapter counts per story_id (one round-trip).
  const { data: chapterIdRows } = await supabase
    .from('chapters')
    .select('story_id')
    .in('story_id', storyRows.map(s => s.id))

  const countByStoryId = new Map<number, number>()
  for (const c of chapterIdRows ?? []) {
    countByStoryId.set(c.story_id, (countByStoryId.get(c.story_id) ?? 0) + 1)
  }

  const stories: StoryListItem[] = storyRows.map(s => ({
    name:        s.name,
    description: s.description,
    icon_sha1:   s.icon_sha1,
    title_sha1:  s.title_sha1,
    cover_sha1:  s.cover_sha1,
    count:       countByStoryId.get(s.id) ?? 0,
  }))

  const isMainline = category === '主线'

  return (
    <div className="h-[calc(100vh-3.5rem-1.75rem)] overflow-hidden flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-ark-bg" />
        <div className="absolute inset-0 opacity-[0.02]"
             style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        <div className="absolute inset-0"
             style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, var(--ark-surface)/60 0%, transparent 60%)' }} />
      </div>

      <div className="flex-1 min-h-0 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 lg:py-10 flex flex-col">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 font-mono text-[11px] text-ark-muted tracking-widest uppercase shrink-0">
          <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
          <span className="text-ark-border">{'//'}</span>
          <span className="text-ark-accent">{category}</span>
        </div>

        {/* Title */}
        <div className="mb-6 sm:mb-8 shrink-0">
          <div className="h-0.5 w-8 bg-ark-accent mb-4" />
          <h1 className="text-2xl sm:text-3xl font-thin tracking-widest text-ark-text">{category}</h1>
          <p className="font-mono text-[11px] text-ark-muted mt-3 tracking-widest uppercase">
            <span className="text-ark-accent">{'//'}</span> RECORDS <span className="text-ark-border">·</span>{' '}
            <span className="text-ark-text">{stories.length.toString().padStart(2, '0')}</span> ENTRIES
          </p>
        </div>

        {isMainline ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 sm:pr-2 pb-4">
            <MainlineGrid stories={stories} encodedCategory={encodedCategory} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
            <CategoryBrowser
              stories={stories}
              category={category}
              encodedCategory={encodedCategory}
            />
          </div>
        )}
      </div>
    </div>
  )
}
