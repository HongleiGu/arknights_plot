'use server'

// Structural editing for 大地巡旅 (AP-31).
//
// The database is the authority for the book — import_book.py refuses to touch
// one that already exists — so the structure has to be editable somewhere other
// than a terminal. Doing it in SQL is possible but unpleasant: moving a printed
// page between chapters is not a `chapters` edit at all, it is an UPDATE of
// every node on that page plus a renumber of both chapters, and getting the seq
// arithmetic wrong silently scrambles reading order.
//
// Every operation here is one the book has actually needed:
//   rename        — 23 titles were fixed by hand and reverted by an import
//   move a page   — the appendix restructure (417-430 in the wrong chapter)
//   drop a copy   — page 159 exists twice, claimed by two chapter markers
//   delete        — a chapter deleted by hand took its 148 paragraphs with it,
//                   so this refuses unless the chapter is already empty
//
// Reordering uses `order_in_story` because that is the URL segment; a duplicate
// makes one chapter unreachable, so it is kept 1..N on every write.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'

const CATEGORY = '大地巡旅'

export interface ChapterInfo {
  id: number
  storyId: number
  storyName: string
  levelCode: string | null
  levelName: string | null
  order: number
  nodes: number
  pages: number[]
}

export interface StructureReport {
  stories: { id: number; name: string; seq: number | null }[]
  chapters: ChapterInfo[]
  /** Pages claimed by more than one chapter — the page editor cannot target these. */
  splitPages: { page: number; chapterIds: number[] }[]
  /** Chapters holding nothing. Usually the remains of a move. */
  emptyChapters: number[]
}

async function guard() {
  if (!(await isCurrentUserAdmin())) return '无权限（仅管理员）'
  return null
}

/** Every row of a table matching a filter — PostgREST caps a response at 1000. */
async function all<T>(q: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) return out
  }
}

export async function getBookStructure(): Promise<StructureReport | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const { data: st } = await db.from('stories')
    .select('id, name, seq').eq('category', CATEGORY).order('seq')
  const stories = (st ?? []) as { id: number; name: string; seq: number | null }[]
  if (!stories.length) return { error: '书籍尚未导入' }
  const sid = new Map(stories.map(s => [s.id, s.name]))

  const chs = await all<{ id: number; story_id: number; level_code: string | null
                          level_name: string | null; order_in_story: number }>(
    from => db.from('chapters')
      .select('id, story_id, level_code, level_name, order_in_story')
      .in('story_id', [...sid.keys()]).order('story_id').order('order_in_story')
      .range(from, from + 999))

  const nodes = await all<{ chapter_id: number; raw_params: { page?: number } | null }>(
    from => db.from('nodes').select('chapter_id, raw_params')
      .in('chapter_id', chs.map(c => c.id)).range(from, from + 999))

  const pagesOf = new Map<number, Set<number>>()
  const countOf = new Map<number, number>()
  const owners = new Map<number, Set<number>>()
  for (const n of nodes) {
    countOf.set(n.chapter_id, (countOf.get(n.chapter_id) ?? 0) + 1)
    const pg = n.raw_params?.page
    if (pg == null) continue
    if (!pagesOf.has(n.chapter_id)) pagesOf.set(n.chapter_id, new Set())
    pagesOf.get(n.chapter_id)!.add(pg)
    if (!owners.has(pg)) owners.set(pg, new Set())
    owners.get(pg)!.add(n.chapter_id)
  }

  const chapters: ChapterInfo[] = chs.map(c => ({
    id: c.id, storyId: c.story_id, storyName: sid.get(c.story_id) ?? '?',
    levelCode: c.level_code, levelName: c.level_name, order: c.order_in_story,
    nodes: countOf.get(c.id) ?? 0,
    pages: [...(pagesOf.get(c.id) ?? [])].sort((a, b) => a - b),
  }))

  return {
    stories,
    chapters,
    splitPages: [...owners.entries()].filter(([, s]) => s.size > 1)
      .map(([page, s]) => ({ page, chapterIds: [...s].sort((a, b) => a - b) }))
      .sort((a, b) => a.page - b.page),
    emptyChapters: chapters.filter(c => c.nodes === 0).map(c => c.id),
  }
}

export async function renameChapter(
  id: number, levelName: string, levelCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  if (!levelName.trim()) return { ok: false, error: '章节名不能为空' }
  const db = await createClient()

  // level_code is what 泰拉年表 cites the book by (`大地巡旅：6.Extra 罗德岛`)
  // and what the import keys a section to, so a duplicate is not cosmetic: it
  // is exactly what merged 乌萨斯建国 into 拉特兰信仰 and left a chapter empty.
  const { data: clash } = await db.from('chapters')
    .select('id, story_id').eq('level_code', levelCode.trim()).neq('id', id)
  const { data: me } = await db.from('chapters').select('story_id').eq('id', id).maybeSingle()
  if (clash?.some(c => c.story_id === me?.story_id)) {
    return { ok: false, error: `编号 ${levelCode} 在本卷中已被占用` }
  }

  const { error } = await db.from('chapters')
    .update({ level_name: levelName.trim(), level_code: levelCode.trim() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/大地巡旅', 'layout')
  return { ok: true }
}

export async function deleteChapter(id: number): Promise<{ ok: boolean; error?: string }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  const db = await createClient()

  // Deleting a chapter cascades to its nodes. That is how 148 paragraphs of
  // 组织名录 vanished with nothing to warn anyone, so this refuses rather than
  // confirms: move the pages out first, and the delete becomes safe by
  // construction.
  const { count } = await db.from('nodes')
    .select('id', { count: 'exact', head: true }).eq('chapter_id', id)
  if (count) {
    return { ok: false,
             error: `该章节仍有 ${count} 个段落；请先把页面移到其他章节，再删除空章节` }
  }
  const { data: me } = await db.from('chapters')
    .select('story_id, order_in_story').eq('id', id).maybeSingle()
  const { error } = await db.from('chapters').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  if (me) await compactOrder(db, me.story_id)
  revalidatePath('/大地巡旅', 'layout')
  return { ok: true }
}

/**
 * Move every node of one printed page into another chapter.
 *
 * This is the operation SQL makes miserable: the page's nodes change
 * chapter_id, and then BOTH chapters have to be renumbered, because seq is
 * position-within-chapter and the moved rows carry the source chapter's
 * numbering with them. Renumbering by (page, seq) is what keeps the reader's
 * order equal to the printed order.
 */
export async function movePage(
  page: number, toChapterId: number,
): Promise<{ ok: boolean; error?: string; moved?: number }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  const db = await createClient()

  const { data: target } = await db.from('chapters')
    .select('id').eq('id', toChapterId).maybeSingle()
  if (!target) return { ok: false, error: '目标章节不存在' }

  const moving = await all<{ id: number; chapter_id: number }>(
    from => db.from('nodes').select('id, chapter_id')
      .eq('raw_params->>page', String(page)).range(from, from + 999))
  if (!moving.length) return { ok: false, error: `第 ${page} 页没有段落` }

  const sources = [...new Set(moving.map(n => n.chapter_id))]
  if (sources.length === 1 && sources[0] === toChapterId) {
    return { ok: false, error: `第 ${page} 页已经在该章节中` }
  }

  const { error } = await db.from('nodes')
    .update({ chapter_id: toChapterId }).in('id', moving.map(n => n.id))
  if (error) return { ok: false, error: error.message }

  for (const cid of [...new Set([...sources, toChapterId])]) await renumber(db, cid)
  revalidatePath('/大地巡旅', 'layout')
  return { ok: true, moved: moving.length }
}

/**
 * Drop one chapter's copy of a page that another chapter also holds.
 *
 * Only ever valid for a genuine duplicate, so it verifies that the page still
 * lives somewhere else before deleting anything — otherwise this is just a
 * delete button for content, which is what `deleteChapter` exists to refuse.
 */
export async function dropDuplicatePage(
  page: number, fromChapterId: number,
): Promise<{ ok: boolean; error?: string; removed?: number }> {
  const bad = await guard()
  if (bad) return { ok: false, error: bad }
  const db = await createClient()

  const rows = await all<{ id: number; chapter_id: number }>(
    from => db.from('nodes').select('id, chapter_id')
      .eq('raw_params->>page', String(page)).range(from, from + 999))
  const here = rows.filter(r => r.chapter_id === fromChapterId)
  const elsewhere = rows.filter(r => r.chapter_id !== fromChapterId)
  if (!here.length) return { ok: false, error: `第 ${page} 页不在该章节中` }
  if (!elsewhere.length) {
    return { ok: false,
             error: `第 ${page} 页只存在于该章节，删除会丢失内容；请改用移动` }
  }

  const { data: removed, error } = await db.from('nodes')
    .delete().in('id', here.map(r => r.id)).select('id')
  if (error) return { ok: false, error: error.message }
  await renumber(db, fromChapterId)
  revalidatePath('/大地巡旅', 'layout')
  return { ok: true, removed: (removed ?? []).length }
}

/** Renumber a chapter's nodes 1..N in printed order (page, then old seq). */
async function renumber(db: Awaited<ReturnType<typeof createClient>>, chapterId: number) {
  const rows = await all<Record<string, unknown> & { id: number; seq: number
                                                     raw_params: { page?: number } | null }>(
    from => db.from('nodes').select('*').eq('chapter_id', chapterId)
      .order('seq').range(from, from + 999))
  if (!rows.length) return
  const sorted = [...rows].sort((a, b) =>
    ((a.raw_params?.page ?? 0) - (b.raw_params?.page ?? 0)) || (a.seq - b.seq))
  const next = sorted.map((r, i) => ({ ...r, seq: i + 1 }))
  if (next.every((r, i) => r.seq === sorted[i].seq)) return
  // Whole rows: an upsert still evaluates its INSERT tuple and `nodes` has NOT
  // NULL columns, so {id, seq} alone is rejected before the conflict clause.
  await db.from('nodes').upsert(next, { onConflict: 'id' })
}

/** Keep order_in_story at 1..N — it is the URL segment, so gaps misaddress. */
async function compactOrder(db: Awaited<ReturnType<typeof createClient>>, storyId: number) {
  const { data } = await db.from('chapters')
    .select('id, order_in_story').eq('story_id', storyId).order('order_in_story')
  const rows = (data ?? []) as { id: number; order_in_story: number }[]
  for (const [i, r] of rows.entries()) {
    if (r.order_in_story !== i + 1) {
      await db.from('chapters').update({ order_in_story: i + 1 }).eq('id', r.id)
    }
  }
}
