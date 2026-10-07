import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import DescriptionEditor from '@/components/DescriptionEditor'

export const dynamic = 'force-dynamic'

interface Props { searchParams: Promise<{ story?: string }> }

export default async function DescriptionsPage({ searchParams }: Props) {
  if (!(await isCurrentUserAdmin())) redirect('/')
  const { story } = await searchParams
  const storyId = story ? parseInt(story, 10) : null

  const db = await createClient()

  // Stories ranked by how much is missing, so the work queue orders itself.
  // 主线 first because it is the only category with no official summaries at
  // all — 情报处理室 carries none of it.
  const { data: st } = await db.from('stories')
    .select('id, category, name, seq')
    .in('category', ['主线', '故事集', '支线'])
    .order('category').order('seq', { ascending: true, nullsFirst: false }).order('id')
  const stories = (st ?? []) as
    { id: number; category: string; name: string; seq: number | null }[]

  const current = storyId ? stories.find(s => s.id === storyId) : null

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 font-mono text-[12px]">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1 font-sans">
        章节描述
      </h1>
      <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-6">
        {'// CHAPTER DESCRIPTIONS · MANUAL ENTRY'}
      </p>
      <p className="text-[11px] text-ark-muted leading-relaxed mb-8 font-sans">
        官方的 情报处理室 简介覆盖了 93% 的支线，却<b className="text-ark-text">没有一条主线</b>
        ——该页面的源码里连「主线」「黑暗时代」这些字样都不出现，再怎么重新抓取也补不上。
        这里写的描述存为单独的 <code className="text-ark-text">manual</code> 行，
        <code className="text-ark-text">import_wiki_descriptions.py</code> 按
        (chapter_id, source) upsert，看不见也覆盖不了它。
      </p>

      <div className="flex flex-wrap gap-1.5 mb-8">
        {stories.map(s => (
          <Link key={s.id} href={`/admin/descriptions?story=${s.id}`}
                className={`px-2 py-1 border text-[10px] tracking-wider transition-colors
                  ${s.id === storyId
                    ? 'border-ark-accent text-ark-accent'
                    : 'border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim'}`}>
            <span className="text-ark-border">{s.category}</span> {s.name}
          </Link>
        ))}
      </div>

      {current
        ? (<>
            <h2 className="font-sans text-lg text-ark-text mb-3">
              {current.category} · {current.name}
            </h2>
            <DescriptionEditor storyId={current.id} />
          </>)
        : <p className="text-[11px] text-ark-muted font-sans">选择上面的一卷开始。</p>}
    </div>
  )
}
