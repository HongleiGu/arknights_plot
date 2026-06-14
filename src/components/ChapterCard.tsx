import Link from 'next/link'
import { chapterSlug } from '@/lib/chapterSlug'

interface ChapterCardProps {
  category: string
  storyName: string
  chapter: {
    id: number
    level_code: string | null
    level_name: string | null
    stage: string | null
    order_in_story: number
  }
}

export default function ChapterCard({ category, storyName, chapter }: ChapterCardProps) {
  const href = `/${encodeURIComponent(category)}/${encodeURIComponent(storyName)}/${encodeURIComponent(chapterSlug(chapter))}`

  // Display: "GT-1 日正当中 · BEG"; falls back gracefully if any piece is null.
  const head = [chapter.level_code, chapter.level_name].filter(Boolean).join(' ')
  const title = chapter.stage ? `${head} · ${chapter.stage}` : head || `#${chapter.id}`
  const ord = chapter.order_in_story.toString().padStart(2, '0')

  return (
    <Link
      href={href}
      className="group relative flex min-h-16 items-center gap-4 p-3
                 bg-ark-surface border border-ark-border
                 hover:border-ark-accent-dim hover:bg-ark-accent/5
                 transition-colors duration-300"
    >
      {/* Index */}
      <p className="shrink-0 w-9 font-mono text-[10px] text-ark-muted tracking-widest">
        <span className="text-ark-accent">{'//'}</span> {ord}
      </p>

      {/* Title */}
      <p className="min-w-0 flex-1 text-sm text-ark-text group-hover:text-ark-accent-bright
                    transition-colors duration-200 line-clamp-2 leading-snug">
        {title}
      </p>

      {/* Corner accent — grows on hover */}
      <div className="absolute bottom-0 left-0 h-0.5 w-0 bg-ark-accent
                      group-hover:w-full transition-all duration-300" />
    </Link>
  )
}
