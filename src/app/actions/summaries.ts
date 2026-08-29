'use server'

import { revalidatePath } from 'next/cache'
import { AI_MODEL } from '@/lib/ai/llm'
import { createClient } from '@/lib/supabase/server'
import { aiGuard as guard, aiComplete as complete, recordSpend as record } from '@/lib/ai/spend'

const CHAPTER_SYS = `你是「明日方舟」剧情摘要助手。把给定章节的剧情浓缩为 3-6 句中文要点：出场的主要人物、关键事件、结果或转折。只依据给定原文，不臆测、不剧透式罗列台词。直接给摘要，不要标题。`
const STORY_SYS = `你是「明日方舟」剧情摘要助手。下面是一部剧情各章节的摘要，请综合成 4-8 句的整体梗概：主线脉络、核心人物与关系、结局走向。用中文，只依据给定内容。直接给梗概，不要标题。`

const CHAPTER_NODE_CAP = 400

export interface SummaryStatus {
  story: { id: number; name: string } | null
  story_has_summary: boolean
  chapters: { id: number; label: string; has_summary: boolean }[]
}

export async function getSummaryStatus(storyId: number): Promise<SummaryStatus> {
  const db = await createClient()
  const { data: story } = await db.from('stories').select('id, name, description').eq('id', storyId).maybeSingle()
  if (!story) return { story: null, story_has_summary: false, chapters: [] }

  const { data: chs } = await db.from('chapters')
    .select('id, level_code, level_name, order_in_story')
    .eq('story_id', storyId).order('order_in_story')
  const chIds = (chs ?? []).map(c => c.id)
  const { data: sums } = await db.from('content_summaries')
    .select('story_id, chapter_id').or(`story_id.eq.${storyId},chapter_id.in.(${chIds.join(',') || 0})`)
  // Curated wiki descriptions count as "done" too — no need to AI-summarize them.
  const { data: descs } = await db.from('chapter_descriptions')
    .select('chapter_id').in('chapter_id', chIds.length ? chIds : [0])

  const chapterDone = new Set<number>([
    ...(sums ?? []).filter(s => s.chapter_id != null).map(s => s.chapter_id as number),
    ...(descs ?? []).map(d => d.chapter_id as number),
  ])
  // Story counts as done if it has a curated description or an AI summary.
  const storyDone = !!story.description || (sums ?? []).some(s => s.story_id === storyId)

  return {
    story: { id: story.id, name: story.name },
    story_has_summary: storyDone,
    chapters: (chs ?? []).map(c => ({
      id: c.id,
      label: [c.level_code, c.level_name].filter(Boolean).join(' ') || `#${c.id}`,
      has_summary: chapterDone.has(c.id),
    })),
  }
}

export async function generateChapterSummary(chapterId: number): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const { data: nodes } = await g.db.from('nodes')
    .select('speaker, content').eq('chapter_id', chapterId).is('branch_id', null).order('seq').limit(CHAPTER_NODE_CAP)
  const lines = (nodes ?? []).map(n => `${n.speaker ? n.speaker + '：' : ''}${n.content ?? ''}`.trim()).filter(Boolean)
  if (lines.length === 0) return { ok: false, error: '该章节没有可摘要的台词' }

  const { text, usage } = await complete(CHAPTER_SYS, lines.join('\n'))
  await record(g.db, g.id, usage)
  if (!text) return { ok: false, error: '摘要为空' }

  // replace-per-target (idempotent)
  await g.db.from('content_summaries').delete().eq('chapter_id', chapterId)
  const { error } = await g.db.from('content_summaries').insert({ chapter_id: chapterId, summary: text, model: AI_MODEL })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function generateStorySummary(storyId: number): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  // aggregate from chapter summaries (cheap — no re-reading raw nodes)
  const { data: chs } = await g.db.from('chapters').select('id, level_code, level_name, order_in_story').eq('story_id', storyId).order('order_in_story')
  const ids = (chs ?? []).map(c => c.id)
  if (ids.length === 0) return { ok: false, error: '该剧情没有章节' }
  // Prefer curated wiki descriptions, fall back to AI chapter summaries.
  const { data: descs } = await g.db.from('chapter_descriptions').select('chapter_id, body').in('chapter_id', ids)
  const { data: sums } = await g.db.from('content_summaries').select('chapter_id, summary').in('chapter_id', ids)
  const byChapter = new Map<number, string>()
  for (const s of sums ?? []) if (s.chapter_id != null) byChapter.set(s.chapter_id, s.summary)
  for (const d of descs ?? []) if (d.chapter_id != null) byChapter.set(d.chapter_id, d.body) // curated wins
  const parts = (chs ?? []).map(c => {
    const s = byChapter.get(c.id)
    return s ? `【${[c.level_code, c.level_name].filter(Boolean).join(' ')}】\n${s}` : null
  }).filter(Boolean) as string[]
  if (parts.length === 0) return { ok: false, error: '请先生成章节摘要' }

  const { text, usage } = await complete(STORY_SYS, parts.join('\n\n'))
  await record(g.db, g.id, usage)
  if (!text) return { ok: false, error: '摘要为空' }

  await g.db.from('content_summaries').delete().eq('story_id', storyId)
  const { error } = await g.db.from('content_summaries').insert({ story_id: storyId, summary: text, model: AI_MODEL })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ai')
  return { ok: true }
}
