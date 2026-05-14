import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ChapterCard from '@/components/ChapterCard'

interface Props {
  params: Promise<{ category: string; story: string }>
}

export default async function StoryPage({ params }: Props) {
  const { category: encodedCategory, story: encodedStory } = await params
  const category = decodeURIComponent(encodedCategory)
  const storyName = decodeURIComponent(encodedStory)

  const supabase = await createClient()

  // Resolve the story row first; chapter listing comes off its id.
  const { data: story, error: storyErr } = await supabase
    .from('stories')
    .select('id, name, description')
    .eq('category', category)
    .eq('name', storyName)
    .maybeSingle()

  if (storyErr || !story) notFound()

  const { data: chapters, error: chErr } = await supabase
    .from('chapters')
    .select('id, level_code, level_name, stage, order_in_story')
    .eq('story_id', story.id)
    .order('order_in_story')

  if (chErr || !chapters?.length) notFound()

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Background — replace div below with <Image> from Supabase storage keyed to story */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-ark-surface" />
        {/* Subtle diagonal lines */}
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(to bottom, var(--ark-bg) 0%, transparent 30%, transparent 70%, var(--ark-bg) 100%)' }} />
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-16">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-10 font-mono text-[11px] text-ark-muted tracking-widest uppercase">
          <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encodedCategory}`} className="hover:text-ark-accent transition-colors">
            {category}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <span className="text-ark-accent normal-case">{storyName}</span>
        </div>

        {/* Title */}
        <div className="mb-12">
          <div className="h-0.5 w-8 bg-ark-accent mb-4" />
          <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-2">
            <span className="text-ark-accent">{'//'}</span> ARC
          </p>
          <h1 className="text-3xl font-thin tracking-widest text-ark-text">{storyName}</h1>
          <p className="font-mono text-[11px] text-ark-muted mt-3 tracking-widest uppercase">
            <span className="text-ark-accent">{'//'}</span> CHAPTERS <span className="text-ark-border">·</span>{' '}
            <span className="text-ark-text">{chapters.length.toString().padStart(2, '0')}</span>
          </p>
        </div>

        {/* Chapter grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {chapters.map((chapter) => (
            <ChapterCard
              key={chapter.id}
              category={category}
              storyName={storyName}
              chapter={chapter}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
