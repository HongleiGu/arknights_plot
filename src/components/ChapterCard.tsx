import Link from 'next/link'

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
  const href = `/${encodeURIComponent(category)}/${encodeURIComponent(storyName)}/${chapter.id}`

  // Display: "GT-1 日正当中 · BEG"; falls back gracefully if any piece is null.
  const head = [chapter.level_code, chapter.level_name].filter(Boolean).join(' ')
  const title = chapter.stage ? `${head} · ${chapter.stage}` : head || `#${chapter.id}`

  return (
    <Link href={href} className="group flex flex-col">
      {/* Image placeholder */}
      <div className="relative aspect-video w-full overflow-hidden bg-ark-surface border border-ark-border
                      group-hover:border-ark-accent-dim transition-colors duration-300">
        {/* Diagonal accent line */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-ark-muted text-xs tracking-widest uppercase">
            {chapter.order_in_story.toString().padStart(2, '0')}
          </span>
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-ark-accent/5 opacity-0 group-hover:opacity-100
                        transition-opacity duration-300" />
        {/* Corner accent */}
        <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-ark-accent
                        group-hover:w-full transition-all duration-300" />
      </div>

      {/* Title */}
      <div className="mt-2 px-1">
        <p className="text-xs text-ark-muted mb-0.5">
          {chapter.order_in_story.toString().padStart(2, '0')}
        </p>
        <p className="text-sm text-ark-text group-hover:text-ark-accent-bright
                      transition-colors duration-200 line-clamp-2 leading-snug">
          {title}
        </p>
      </div>
    </Link>
  )
}
