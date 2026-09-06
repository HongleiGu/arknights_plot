'use server'

import { revalidatePath } from 'next/cache'
import { AI_MODEL } from '@/lib/ai/llm'
import { createClient } from '@/lib/supabase/server'
import { aiGuard as guard, aiComplete as complete, recordSpend as record, type Db } from '@/lib/ai/spend'

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
  return _chapterSummary(g, chapterId)
}

type Guard = Exclude<Awaited<ReturnType<typeof guard>>, { error: string }>

/**
 * The generation half, with the admin/budget gate already resolved.
 *
 * Split out for the batch runner: `guard()` costs an auth round trip plus a
 * budget RPC, and paying that 1600 times to back-fill the archive would cost
 * more requests than the summarising itself.
 */
async function _chapterSummary(g: Guard, chapterId: number): Promise<{ ok: boolean; error?: string }> {
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
  const r = await _storySummary(g, storyId)
  if (r.ok) revalidatePath('/admin/ai')
  return r
}

async function _storySummary(g: Guard, storyId: number): Promise<{ ok: boolean; error?: string }> {
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
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Batch back-fill (AP-29)
//
// AP-23 shipped the generation; it never shipped a way to RUN it at archive
// scale. The per-story panel needs a story id typed in by hand and aborts the
// whole run on the first error, so 13 of 2080 chapters had summaries.
//
// Three things make this survivable:
//   * the backlog query IS the cursor — anything already summarised is skipped,
//     so a run that dies halfway resumes exactly where it stopped and there is
//     no job table to keep consistent;
//   * each call is time-boxed, so no single request approaches the serverless
//     limit no matter how slow the model is;
//   * one item failing is recorded and skipped, not fatal. On a 1600-item
//     back-fill over a free, rate-limited model, "abort everything on one 429"
//     is the same as "never finishes".
// ---------------------------------------------------------------------------

/** PostgREST caps a response at 1000 rows silently — page every full scan. */
async function allIds<T extends Record<string, unknown>>(
  db: Db, table: string, cols: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from(table).select(cols).range(from, from + 999)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export interface SummaryBacklog {
  chaptersTotal: number; chaptersDone: number; chaptersTodo: number
  storiesTotal: number;  storiesDone: number;  storiesTodo: number
}

async function backlogIds(db: Db) {
  const [chs, stories, descs, sums] = await Promise.all([
    allIds<{ id: number }>(db, 'chapters', 'id'),
    allIds<{ id: number; description: string | null }>(db, 'stories', 'id, description'),
    allIds<{ chapter_id: number | null }>(db, 'chapter_descriptions', 'chapter_id'),
    allIds<{ story_id: number | null; chapter_id: number | null }>(db, 'content_summaries', 'story_id, chapter_id'),
  ])
  // A curated wiki description counts as done — it is better than anything the
  // model would write, and re-summarising it would spend tokens to get worse.
  const chapterDone = new Set<number>([
    ...descs.map(d => d.chapter_id).filter((v): v is number => v != null),
    ...sums.map(s => s.chapter_id).filter((v): v is number => v != null),
  ])
  const storyDone = new Set<number>([
    ...stories.filter(s => s.description).map(s => s.id),
    ...sums.map(s => s.story_id).filter((v): v is number => v != null),
  ])
  return {
    chs, stories, chapterDone, storyDone,
    chapterTodo: chs.filter(c => !chapterDone.has(c.id)).map(c => c.id),
    storyTodo: stories.filter(s => !storyDone.has(s.id)).map(s => s.id),
  }
}

export async function getSummaryBacklog(): Promise<SummaryBacklog | { error: string }> {
  const g = await guard()
  if ('error' in g) return { error: g.error }
  const b = await backlogIds(g.db)
  return {
    chaptersTotal: b.chs.length, chaptersDone: b.chs.length - b.chapterTodo.length,
    chaptersTodo: b.chapterTodo.length,
    storiesTotal: b.stories.length, storiesDone: b.stories.length - b.storyTodo.length,
    storiesTodo: b.storyTodo.length,
  }
}

export interface BatchResult {
  processed: number
  failed: { id: number; kind: 'chapter' | 'story'; error: string }[]
  remaining: number
  /** Rate limited — the caller should wait before asking for another slice. */
  rateLimited: boolean
  error?: string
}

/** A 429 (or a provider phrasing it in prose) means wait, not fail. */
function isRateLimit(e: unknown): boolean {
  const status = (e as { status?: number })?.status
  const msg = String((e as { message?: string })?.message ?? '')
  return status === 429 || /rate.?limit|too many requests|quota/i.test(msg)
}

const BATCH_MS = 20_000

/**
 * Process one time-boxed slice of the backlog.
 *
 * Chapters first: a story summary is built from its chapters, so running
 * stories first would summarise from a half-empty set and then look "done".
 */
export async function runSummaryBatch(): Promise<BatchResult> {
  const g = await guard()
  if ('error' in g) return { processed: 0, failed: [], remaining: 0, rateLimited: false, error: g.error }

  const b = await backlogIds(g.db)
  const queue: { id: number; kind: 'chapter' | 'story' }[] = [
    ...b.chapterTodo.map(id => ({ id, kind: 'chapter' as const })),
    ...b.storyTodo.map(id => ({ id, kind: 'story' as const })),
  ]

  const started = Date.now()
  const failed: BatchResult['failed'] = []
  let processed = 0
  let rateLimited = false

  for (const item of queue) {
    if (Date.now() - started > BATCH_MS) break
    try {
      const r = item.kind === 'chapter'
        ? await _chapterSummary(g, item.id)
        : await _storySummary(g, item.id)
      if (r.ok) processed++
      else failed.push({ ...item, error: r.error ?? '未知错误' })
    } catch (e) {
      if (isRateLimit(e)) { rateLimited = true; break }
      failed.push({ ...item, error: String((e as { message?: string })?.message ?? e) })
    }
  }

  revalidatePath('/admin/ai')
  return { processed, failed, remaining: queue.length - processed, rateLimited }
}
