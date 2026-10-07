'use server'

// Hand-written chapter descriptions (AP-37, migration 043).
//
// The official 情报处理室 summaries cover 93% of 支线 and 0% of 主线 — that page
// carries no main-story entries at all, so the gap cannot be scraped away from
// there. This is where the missing ones get written.
//
// A manual description is a SEPARATE row (`source = 'manual'`), never an edit
// of the scraped one. import_wiki_descriptions.py upserts on
// (chapter_id, source) with its own source, so it cannot see or clobber a
// manual row — the same arrangement as book_page_overrides. Editing the
// scraped row in place would be reverted by the next --sync, silently.
//
// Readers should use the `chapter_description_effective` view, which returns
// one row per chapter with the manual one winning.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'

export const MANUAL_SOURCE = 'manual'

export interface ChapterDescription {
  chapterId: number
  levelCode: string | null
  levelName: string | null
  order: number
  /** What a reader currently sees — manual if present, else scraped. */
  body: string | null
  source: string | null
  /** The scraped text, kept visible so an editor can see what they override. */
  scraped: string | null
  manual: string | null
}

async function guard() {
  return (await isCurrentUserAdmin()) ? null : '无权限（仅管理员）'
}

/** Every chapter of a story with its descriptions, for the editor. */
export async function listStoryDescriptions(
  storyId: number,
): Promise<{ chapters: ChapterDescription[] } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const { data: chs, error } = await db.from('chapters')
    .select('id, level_code, level_name, order_in_story')
    .eq('story_id', storyId).order('order_in_story')
  if (error) return { error: error.message }
  const chapters = (chs ?? []) as {
    id: number; level_code: string | null
    level_name: string | null; order_in_story: number
  }[]
  if (!chapters.length) return { chapters: [] }

  // Both rows, not the view: the editor needs to show the scraped text
  // alongside the override so it is obvious what is being replaced.
  const ids = chapters.map(c => c.id)
  const rows: { chapter_id: number; source: string; body: string }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('chapter_descriptions')
      .select('chapter_id, source, body').in('chapter_id', ids.slice(i, i + 200))
    rows.push(...(data ?? []) as typeof rows)
  }
  const manual = new Map(rows.filter(r => r.source === MANUAL_SOURCE)
                             .map(r => [r.chapter_id, r.body]))
  const scraped = new Map(rows.filter(r => r.source !== MANUAL_SOURCE)
                              .map(r => [r.chapter_id, r.body]))

  return {
    chapters: chapters.map(c => ({
      chapterId: c.id,
      levelCode: c.level_code,
      levelName: c.level_name,
      order: c.order_in_story,
      manual: manual.get(c.id) ?? null,
      scraped: scraped.get(c.id) ?? null,
      body: manual.get(c.id) ?? scraped.get(c.id) ?? null,
      source: manual.has(c.id) ? MANUAL_SOURCE
            : scraped.has(c.id) ? 'scraped' : null,
    })),
  }
}

export async function saveChapterDescription(
  chapterId: number, body: string,
): Promise<{ ok: boolean; error?: string }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  const text = body.trim()
  if (!text) return { ok: false, error: '内容为空；要移除请用「清除」' }

  const db = await createClient()
  const { error } = await db.from('chapter_descriptions')
    .upsert({ chapter_id: chapterId, source: MANUAL_SOURCE, body: text },
            { onConflict: 'chapter_id,source' })
  if (error) {
    // The likeliest cause is 043 not being applied: the table is public-read
    // with no write policy, so the insert is refused rather than ignored.
    return { ok: false, error: `${error.message}（若为权限错误，请确认迁移 043 已应用）` }
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function clearChapterDescription(
  chapterId: number,
): Promise<{ ok: boolean; error?: string }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  const db = await createClient()

  // Verify the delete actually removed the row. Under RLS a disallowed delete
  // affects zero rows WITHOUT erroring, so without this check a missing policy
  // looks like a successful no-op — the trap 041 was written for.
  const { data, error } = await db.from('chapter_descriptions')
    .delete().eq('chapter_id', chapterId).eq('source', MANUAL_SOURCE).select('id')
  if (error) return { ok: false, error: error.message }
  if (!(data ?? []).length) {
    return { ok: false, error: '没有可清除的人工描述（或迁移 043 未应用）' }
  }
  revalidatePath('/', 'layout')
  return { ok: true }
}
