'use server'

// Entity review (AP-35/AP-36, migration 044).
//
// 6,889 distinct speakers became `character` entities, and most of them are not
// people in any useful sense. Measured over all 715 stories: 5,633 speak in
// exactly one story, and of the 148 non-operator speakers appearing in five or
// more, three different things are mixed together —
//
//   named    塔露拉 (17 stories, 1,605 lines), 魏彦吾, 特蕾西娅: real people with
//            no playable 干员 record. One vertex is correct.
//   scoped   医疗干员 (44 stories), 罗德岛干员 (28), 维多利亚士兵 (11): a real being
//            with no name given. One vertex is FORTY-FOUR people, so every edge
//            on it is attached to a composite.
//   device   众人 (a chorus), 广播, 门外的声音, 父亲 (a different man each time):
//            not entities at all.
//
// Which of the three a name is cannot be derived — it is a judgement about what
// the text means — so this is the queue where a human makes it. `044`'s trigger
// then refuses to attach an edge to a `device` or still-`suspicious` vertex, so
// the batch extraction pass physically cannot write onto an unjudged one.
//
// WHY A GLOBAL QUEUE AND NOT A PANEL INSIDE EACH STORY/CHAPTER: the decision is
// about the entity, not about a story. 医疗干员 appears in 44 stories, so a
// per-story panel means 44 visits and 44 chances to decide differently, and the
// 5,633 single-story speakers would never surface in a workable order. The
// confusion a per-story view would avoid comes from missing context, not from
// the page being global — so the context is brought here instead:
// `getEntityEvidence` returns where the name speaks, grouped by story, with
// sample lines, which is what the judgement actually needs.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'
// Constants and types live in lib/graph.ts: a 'use server' file may only
// export async functions, so an `export const` here would make Next treat
// this entire module as having no exports.
import {
  IDENTITIES, REVIEWS,
  type Identity, type Review, type ReviewRow, type EvidenceStory,
} from '@/lib/graph'

async function guard() {
  return (await isCurrentUserAdmin()) ? null : '无权限（仅管理员）'
}

/**
 * The queue, ordered by impact: a name with 600 lines across 44 stories is
 * worth a decision, a one-line NPC is not. `offset` pages it.
 */
export async function listReviewQueue(opts: {
  identity?: Identity | 'all'
  review?: Review | 'all'
  type?: string
  q?: string
  minMentions?: number
  limit?: number
  offset?: number
}): Promise<{ rows: ReviewRow[]; total: number } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  // One string literal, not a concatenation: the typed client parses the select
  // at compile time, and `'a, b' + 'c'` defeats that and degrades every column
  // to GenericStringError.
  let q = db.from('entities')
    .select('id, type, name, name_en, aliases, identity, review, review_note, mention_count, summary', { count: 'exact' })
  if (opts.identity && opts.identity !== 'all') q = q.eq('identity', opts.identity)
  if (opts.review && opts.review !== 'all') q = q.eq('review', opts.review)
  if (opts.type) q = q.eq('type', opts.type)
  if (opts.q) q = q.ilike('name', `%${opts.q}%`)
  if (opts.minMentions) q = q.gte('mention_count', opts.minMentions)

  const { data, error, count } = await q
    .order('mention_count', { ascending: false })
    .order('id')
    .range(offset, offset + limit - 1)
  if (error) return { error: error.message }

  const rows = (data ?? []).map(e => ({
    id: e.id as number,
    type: e.type as string,
    name: e.name as string,
    nameEn: (e.name_en ?? null) as string | null,
    aliases: ((e.aliases ?? []) as string[]),
    identity: (e.identity ?? 'unverified') as Identity,
    review: (e.review ?? 'none') as Review,
    reviewNote: (e.review_note ?? null) as string | null,
    mentionCount: (e.mention_count ?? 0) as number,
    hasSummary: !!e.summary,
  }))
  return { rows, total: count ?? rows.length }
}

/**
 * Where this name speaks, grouped by story — the evidence the judgement needs.
 *
 * A name in one story is probably a local NPC; the same name across 44 is
 * either a real recurring character or a role descriptor, and the sample lines
 * are what tells those apart. Capped at 400 lines because 阿米娅 has 6,803 and
 * nobody needs them to decide she is a person.
 */
export async function getEntityEvidence(
  entityId: number,
): Promise<{ stories: EvidenceStory[]; truncated: boolean } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const { data: ent } = await db.from('entities')
    .select('name, type').eq('id', entityId).maybeSingle()
  if (!ent) return { error: '找不到该实体' }
  // Only `character` rows come from a speaker column; a nation has no lines.
  if (ent.type !== 'character') return { stories: [], truncated: false }

  const CAP = 400
  const { data: ns } = await db.from('nodes')
    .select('chapter_id, content')
    .eq('speaker', ent.name as string)
    .order('id')
    .limit(CAP)
  const nodes = (ns ?? []) as { chapter_id: number; content: string | null }[]
  if (!nodes.length) return { stories: [], truncated: false }

  const chIds = [...new Set(nodes.map(n => n.chapter_id))]
  const { data: chs } = await db.from('chapters')
    .select('id, story_id').in('id', chIds)
  const chapterStory = new Map(
    ((chs ?? []) as { id: number; story_id: number }[]).map(c => [c.id, c.story_id]))

  const storyIds = [...new Set([...chapterStory.values()])]
  const { data: sts } = await db.from('stories')
    .select('id, name, category').in('id', storyIds)
  const storyInfo = new Map(
    ((sts ?? []) as { id: number; name: string; category: string }[])
      .map(s => [s.id, s]))

  const acc = new Map<number, EvidenceStory>()
  for (const n of nodes) {
    const sid = chapterStory.get(n.chapter_id)
    if (sid == null) continue
    const info = storyInfo.get(sid)
    let row = acc.get(sid)
    if (!row) {
      row = {
        storyId: sid,
        storyName: info?.name ?? `#${sid}`,
        category: info?.category ?? '?',
        lines: 0,
        samples: [],
      }
      acc.set(sid, row)
    }
    row.lines++
    const t = (n.content ?? '').trim()
    if (row.samples.length < 2 && t.length >= 6) row.samples.push(t.slice(0, 140))
  }
  const stories = [...acc.values()].sort((a, b) => b.lines - a.lines)
  return { stories, truncated: nodes.length >= CAP }
}

/**
 * Set the judgement. `review` moves with it by default because the two are one
 * decision: saying what a name IS is the act of having looked at it.
 */
export async function setEntityIdentity(
  entityId: number, identity: Identity, note?: string,
): Promise<{ ok: true } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  if (!IDENTITIES.includes(identity)) return { error: `未知的 identity：${identity}` }
  const db = await createClient()

  const patch: Record<string, unknown> = {
    identity,
    // 'unverified' is the only value that is not a decision, so it is the only
    // one that leaves the row in the queue.
    review: identity === 'unverified' ? 'suspicious' : 'reviewed',
  }
  if (note !== undefined) patch.review_note = note.trim() || null

  const { error, data } = await db.from('entities')
    .update(patch).eq('id', entityId).select('id')
  if (error) return { error: error.message }
  // RLS filters a disallowed write to zero rows WITHOUT raising, so an empty
  // result is the only signal that the policy refused.
  if (!data?.length) return { error: '未写入任何行（RLS 拒绝或 id 不存在）' }

  revalidatePath('/admin/entities')
  revalidatePath(`/world/${entityId}`)
  return { ok: true }
}

/** Flag or clear without committing to what the name is. */
export async function setEntityReview(
  entityId: number, review: Review, note?: string,
): Promise<{ ok: true } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  if (!REVIEWS.includes(review)) return { error: `未知的 review：${review}` }
  const db = await createClient()

  const patch: Record<string, unknown> = { review }
  if (note !== undefined) patch.review_note = note.trim() || null
  const { error, data } = await db.from('entities')
    .update(patch).eq('id', entityId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: '未写入任何行（RLS 拒绝或 id 不存在）' }

  revalidatePath('/admin/entities')
  return { ok: true }
}

/**
 * Rename, or edit the alias list.
 *
 * `aliases` holds only officially-stated alternates — 安洁莉娜's
 * 本名安心院安洁莉娜, straight out of her 客观履历. An alias that is a CLAIM
 * ("模糊的声音 is 凯尔希") belongs in `entity_relations` as 同一人 with citations,
 * because a bare string here carries no provenance and would assert a reveal
 * the game may still be withholding.
 */
export async function updateEntityNames(
  entityId: number, patch: { name?: string; nameEn?: string | null; aliases?: string[] },
): Promise<{ ok: true } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (!n) return { error: '名称不能为空' }
    body.name = n
  }
  if (patch.nameEn !== undefined) body.name_en = patch.nameEn?.trim() || null
  if (patch.aliases !== undefined) {
    body.aliases = [...new Set(patch.aliases.map(a => a.trim()).filter(Boolean))]
  }
  if (!Object.keys(body).length) return { ok: true }

  const { error, data } = await db.from('entities')
    .update(body).eq('id', entityId).select('id')
  if (error) {
    // UNIQUE (type, name): renaming onto an existing row is a merge, which this
    // does not do — merging has to move relations and aliases too.
    if (error.code === '23505') {
      return { error: '该 (type, name) 已存在；合并实体需要迁移关系，暂不支持' }
    }
    return { error: error.message }
  }
  if (!data?.length) return { error: '未写入任何行（RLS 拒绝或 id 不存在）' }

  revalidatePath('/admin/entities')
  return { ok: true }
}

/**
 * Delete a vertex. Only sensible for a `device` row (众人, 广播) that should
 * never have existed. `entity_relations` cascades (026), so this takes its edges
 * with it — which is why the UI asks first.
 */
export async function deleteEntity(
  entityId: number,
): Promise<{ ok: true } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()
  const { error, data } = await db.from('entities')
    .delete().eq('id', entityId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: '未删除任何行（RLS 拒绝或 id 不存在）' }
  revalidatePath('/admin/entities')
  return { ok: true }
}

/** Counts for the queue header, so progress is visible. */
export async function reviewProgress(): Promise<
  { byIdentity: Record<string, number>; suspicious: number } | { error: string }
> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()
  const byIdentity: Record<string, number> = {}
  for (const id of IDENTITIES) {
    const { count } = await db.from('entities')
      .select('id', { count: 'exact', head: true }).eq('identity', id)
    byIdentity[id] = count ?? 0
  }
  const { count: suspicious } = await db.from('entities')
    .select('id', { count: 'exact', head: true }).eq('review', 'suspicious')
  return { byIdentity, suspicious: suspicious ?? 0 }
}
