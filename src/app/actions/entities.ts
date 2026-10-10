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
  type StoryProgress, type CastRow,
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

/**
 * Which stories still have speakers nobody has judged (045).
 *
 * Returns `null` for `progress` when `story_review_progress()` is absent, so
 * the page can say which migration is missing instead of showing an error.
 */
export async function listStoryReviewProgress(): Promise<
  { progress: StoryProgress[] } | { error: string; missing?: true }
> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const { data, error } = await db.rpc('story_review_progress')
  if (error) {
    if (/story_review_progress/.test(error.message)) {
      return { error: error.message, missing: true }
    }
    return { error: error.message }
  }
  const rows = (data ?? []) as {
    story_id: number; story_name: string; category: string
    speakers: number; unresolved: number; lines: number
  }[]
  return {
    progress: rows.map(r => ({
      storyId: r.story_id, storyName: r.story_name, category: r.category,
      speakers: Number(r.speakers), unresolved: Number(r.unresolved),
      lines: Number(r.lines),
    })).sort((a, b) => b.unresolved - a.unresolved || b.lines - a.lines),
  }
}

/**
 * A plain story list, for when `045` has not been applied yet.
 *
 * The cast view itself needs nothing new — it runs on `scope_speakers()` (034) —
 * so the only thing missing without `045` is knowing WHICH story to open. This
 * supplies that from `stories` alone, without the unresolved counts, so the
 * review is usable immediately and `045` is an upgrade rather than a gate.
 *
 * 漫画 and 大地巡旅 are excluded: comics have chapters but no imported dialogue,
 * and the book's only speaker is `narrator`, which `scope_speakers()` filters —
 * both would open to an empty cast.
 */
export async function listStoriesPlain(): Promise<
  { stories: { storyId: number; storyName: string; category: string }[] } | { error: string }
> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()
  const rows: { id: number; name: string; category: string; seq: number | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('stories')
      .select('id, name, category, seq')
      .not('category', 'in', '("漫画","大地巡旅")')
      .range(from, from + 999)
    if (error) return { error: error.message }
    const got = (data ?? []) as typeof rows
    rows.push(...got)
    if (got.length < 1000) break
  }
  rows.sort((a, b) =>
    a.category.localeCompare(b.category)
    || (a.seq ?? 1e9) - (b.seq ?? 1e9)
    || a.id - b.id)
  return {
    stories: rows.map(r => ({
      storyId: r.id, storyName: r.name, category: r.category,
    })),
  }
}

/**
 * Every speaker in one story, with the context needed to judge it there.
 *
 * Sample lines come from THIS story only. That is the point of working per
 * story: the lines that tell you whether 模糊的声音 is a device or somebody
 * already in the room are the ones in the room.
 */
export async function listStoryCast(
  storyId: number,
): Promise<{ story: string; cast: CastRow[] } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const { data: st } = await db.from('stories')
    .select('id, name, category').eq('id', storyId).maybeSingle()
  if (!st) return { error: '找不到该故事' }

  // scope_speakers (034) groups in the database and applies the same
  // narrator/？？？ exclusions as the progress function.
  const { data: sp, error: spErr } = await db.rpc('scope_speakers', { p_story: storyId })
  if (spErr) return { error: spErr.message }
  const speakers = (sp ?? []) as { speaker: string; lines: number }[]
  if (!speakers.length) return { story: st.name as string, cast: [] }

  const names = speakers.map(s => s.speaker)
  const { data: ents } = await db.from('entities')
    .select('id, name, identity, review, review_note, mention_count, raw')
    .eq('type', 'character').in('name', names)
  const byName = new Map(((ents ?? []) as {
    id: number; name: string; identity: string; review: string
    review_note: string | null; mention_count: number; raw: Record<string, unknown> | null
  }[]).map(e => [e.name, e]))

  // Sample lines, one query over the story's chapters rather than one per
  // speaker — a story has a handful of chapters and a few thousand lines.
  const { data: chs } = await db.from('chapters').select('id').eq('story_id', storyId)
  const chIds = ((chs ?? []) as { id: number }[]).map(c => c.id)
  const samples = new Map<string, string[]>()
  if (chIds.length) {
    for (let from = 0; from < 4000; from += 1000) {
      const { data } = await db.from('nodes')
        .select('speaker, content').in('chapter_id', chIds)
        .not('speaker', 'is', null).order('id').range(from, from + 999)
      const got = (data ?? []) as { speaker: string | null; content: string | null }[]
      for (const n of got) {
        const k = (n.speaker ?? '').trim()
        const t = (n.content ?? '').trim()
        if (!k || t.length < 6) continue
        const acc = samples.get(k) ?? []
        if (acc.length < 3) { acc.push(t.slice(0, 160)); samples.set(k, acc) }
      }
      if (got.length < 1000) break
    }
  }

  const cast: CastRow[] = speakers.map(s => {
    const e = byName.get(s.speaker)
    return {
      entityId: e?.id ?? null,
      name: s.speaker,
      linesHere: Number(s.lines),
      linesTotal: e?.mention_count ?? 0,
      storiesTotal: null,
      identity: (e?.identity ?? null) as CastRow['identity'],
      review: (e?.review ?? null) as CastRow['review'],
      reviewNote: e?.review_note ?? null,
      hasRecord: (e?.raw ?? {})['source'] === 'personnel_file/客观履历',
      samples: samples.get(s.speaker) ?? [],
    }
  })
  return { story: st.name as string, cast }
}

// NOTE: there is deliberately no name-similarity candidate finder.
//
// One existed and was removed: it paired rows by spelling across all 715
// stories, which is exactly where coincidence lives. Containment alone gave
// 4,810 pairs led by 曼弗雷德→雷德 and 华法琳→法琳; of six that survived a
// stricter rule, four were suffix accidents (安娜 from 薇薇安娜, 瑟琳 from
// 凯瑟琳, 威尔 from 诺威尔, 法琳 from 华法琳), because the ending of a Chinese
// transliteration carries no relationship. A rule like that does not produce
// uncertainty, it produces confident mistakes.
//
// Review is per story instead (`listStoryCast`): inside one story the cast is
// a few dozen names, the lines that answer "is this somebody already in the
// room" are in that room, and a wrong pairing cannot arrive from a story the
// reviewer never opened. `mergeEntities` and `linkSameCharacter` are still
// here — they are driven by an explicit choice now, not by a rule.

/**
 * Link two rows as the same person WITHOUT destroying either (044).
 *
 * This is the right action for an 异格: 荒芜拉普兰德 and 拉普兰德 are one person, but
 * each has its own official 客观履历 emphasising different things, and a merge
 * would throw one away. `同一人` is a relation kind precisely so that identity
 * can be asserted without collapsing the records.
 *
 * Cited, not merely asserted: the evidence is the alt form's own 客观履历, whose
 * `text_chunks` row is already recorded in `raw.refs` — `@text/<id>`, which
 * `044`'s grounding CHECK accepts as precise. Note that `@entity/<id>` would
 * NOT pass that check, which is why the text chunk is used. Falls back to
 * `source = 'manual'` only when there is no such citation to give.
 */
export async function linkSameCharacter(
  aId: number, bId: number,
): Promise<{ ok: true; cited: string | null } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  if (aId === bId) return { error: '不能与自身建立关系' }
  const db = await createClient()

  const { data: pair } = await db.from('entities')
    .select('id, type, name, identity, review, raw').in('id', [aId, bId])
  const a = (pair ?? []).find(e => e.id === aId)
  const b = (pair ?? []).find(e => e.id === bId)
  if (!a || !b) return { error: '找不到其中一个实体' }
  for (const e of [a, b]) {
    if (e.identity === 'device' || e.review === 'suspicious') {
      return { error: `「${e.name}」还没判定（${e.identity}/${e.review}），请先判定` }
    }
  }

  // 同一人 is symmetric, so it is stored once with from < to — the canonical
  // ordering that makes UNIQUE(from,to,kind) mean anything.
  const [from, to] = aId < bId ? [aId, bId] : [bId, aId]

  const refOf = (e: typeof a) =>
    (((e.raw ?? {}) as { refs?: unknown }).refs as string[] | undefined)
      ?.find(r => r.startsWith('@text/')) ?? null
  const cited = refOf(b) ?? refOf(a)

  const { error } = await db.from('entity_relations').upsert({
    from_entity_id: from, to_entity_id: to, kind: '同一人',
    note: `${a.name} 与 ${b.name} 是同一人（异格/别名），各自保留官方档案`,
    source: cited ? 'scraped' : 'manual',
    source_refs: cited ? [cited] : [],
  }, { onConflict: 'from_entity_id,to_entity_id,kind' })
  if (error) return { error: error.message }

  revalidatePath('/admin/entities')
  revalidatePath(`/world/${aId}`)
  revalidatePath(`/world/${bId}`)
  return { ok: true, cited }
}

export interface MergeReport {
  relationsMoved: number
  relationsDropped: number
  commentsMoved: number
  boardMembersMoved: number
  boardTextRewritten: number
  aliasesAdded: string[]
  tookSummary: boolean
}

/**
 * Merge `dropId` into `keepId`: everything that referenced the one is repointed
 * at the other, then the duplicate row is deleted.
 *
 * ORDER MATTERS AND IS THE WHOLE RISK. `entity_relations.from/to_entity_id`,
 * `comment_anchors.entity_id` and `correlation_members.entity_id` all declare
 * `ON DELETE CASCADE` (026 / 027), so deleting the row first would silently take
 * a reader's comment and a board node with it. Everything is moved before
 * anything is deleted.
 *
 * Four things are handled that a naive UPDATE would get wrong:
 *  - a repointed edge can become a SELF-LOOP (A—kind→A) and `026`'s
 *    `entity_relations_no_self` CHECK refuses it, so those are dropped;
 *  - it can COLLIDE with an existing (from, to, kind) under the UNIQUE
 *    constraint, so a duplicate is dropped rather than erroring;
 *  - a symmetric kind must keep `from < to` — the canonical ordering is what
 *    makes that UNIQUE mean anything — so the ends are swapped if repointing
 *    inverted them, with symmetry read from `relation_kinds`, not guessed;
 *  - board node TEXT may contain `@entity/<dropId>`, which no FK can repoint.
 *    Those tokens are rewritten, and `033`'s `sync_member_refs` trigger
 *    reindexes `correlation_member_refs` from the new text by itself.
 */
export async function mergeEntities(
  keepId: number, dropId: number,
): Promise<{ report: MergeReport } | { error: string }> {
  const bad = await guard()
  if (bad) return { error: bad }
  if (keepId === dropId) return { error: '不能与自身合并' }
  const db = await createClient()

  const { data: pair } = await db.from('entities')
    .select('id, type, name, aliases, summary, summary_status, identity, review, raw')
    .in('id', [keepId, dropId])
  const keep = (pair ?? []).find(e => e.id === keepId)
  const drop = (pair ?? []).find(e => e.id === dropId)
  if (!keep || !drop) return { error: '找不到其中一个实体' }
  if (keep.type !== drop.type) {
    return { error: `类型不同（${keep.type} / ${drop.type}），不能合并` }
  }
  // Refuse rather than quietly deciding for the admin: the trigger would block
  // repointing edges onto a device/suspicious row anyway, and silently marking
  // the target reviewed would be making their judgement for them.
  if (keep.identity === 'device' || keep.review === 'suspicious') {
    return { error: `目标「${keep.name}」还没判定（${keep.identity}/${keep.review}），请先判定再合并` }
  }

  const report: MergeReport = {
    relationsMoved: 0, relationsDropped: 0, commentsMoved: 0,
    boardMembersMoved: 0, boardTextRewritten: 0, aliasesAdded: [], tookSummary: false,
  }

  const { data: kinds } = await db.from('relation_kinds').select('key, is_symmetric')
  const symmetric = new Set(((kinds ?? []) as { key: string; is_symmetric: boolean }[])
    .filter(k => k.is_symmetric).map(k => k.key))

  const { data: rels } = await db.from('entity_relations')
    .select('id, from_entity_id, to_entity_id, kind')
    .or(`from_entity_id.eq.${dropId},to_entity_id.eq.${dropId}`)
  const { data: existing } = await db.from('entity_relations')
    .select('from_entity_id, to_entity_id, kind')
  const taken = new Set(((existing ?? []) as { from_entity_id: number; to_entity_id: number; kind: string }[])
    .map(r => `${r.from_entity_id}|${r.to_entity_id}|${r.kind}`))

  for (const r of ((rels ?? []) as { id: number; from_entity_id: number; to_entity_id: number; kind: string }[])) {
    let a = r.from_entity_id === dropId ? keepId : r.from_entity_id
    let b = r.to_entity_id === dropId ? keepId : r.to_entity_id
    if (a === b) {                                   // self-loop
      await db.from('entity_relations').delete().eq('id', r.id)
      report.relationsDropped++
      continue
    }
    if (symmetric.has(r.kind) && a > b) { const t = a; a = b; b = t }
    if (taken.has(`${a}|${b}|${r.kind}`)) {          // duplicate
      await db.from('entity_relations').delete().eq('id', r.id)
      report.relationsDropped++
      continue
    }
    const { error } = await db.from('entity_relations')
      .update({ from_entity_id: a, to_entity_id: b }).eq('id', r.id)
    if (error) return { error: `迁移关系 ${r.id} 失败：${error.message}` }
    taken.add(`${a}|${b}|${r.kind}`)
    report.relationsMoved++
  }

  const { data: anchors } = await db.from('comment_anchors')
    .update({ entity_id: keepId }).eq('entity_id', dropId).select('id')
  report.commentsMoved = anchors?.length ?? 0

  const { data: members } = await db.from('correlation_members')
    .update({ entity_id: keepId }).eq('entity_id', dropId).select('id')
  report.boardMembersMoved = members?.length ?? 0

  // No FK can repoint a token inside user-authored text, so rewrite it. The
  // meaning is unchanged — it is the same entity — and the alternative is a
  // citation that silently stops resolving.
  const { data: texts } = await db.from('correlation_members')
    .select('id, title, body').or(`title.ilike.%@entity/${dropId}%,body.ilike.%@entity/${dropId}%`)
  for (const m of ((texts ?? []) as { id: number; title: string | null; body: string | null }[])) {
    const re = new RegExp(`@entity/${dropId}\\b`, 'g')
    const patch = {
      title: m.title?.replace(re, `@entity/${keepId}`) ?? m.title,
      body: m.body?.replace(re, `@entity/${keepId}`) ?? m.body,
    }
    await db.from('correlation_members').update(patch).eq('id', m.id)
    report.boardTextRewritten++
  }

  const aliases = new Set<string>([
    ...((keep.aliases ?? []) as string[]),
    ...((drop.aliases ?? []) as string[]),
    drop.name as string,
  ])
  aliases.delete(keep.name as string)
  report.aliasesAdded = [...aliases].filter(a => !((keep.aliases ?? []) as string[]).includes(a))

  const raw = { ...((keep.raw ?? {}) as Record<string, unknown>) }
  const history = Array.isArray(raw.merged_from) ? raw.merged_from as unknown[] : []
  raw.merged_from = [...history, { id: dropId, name: drop.name, at: new Date().toISOString() }]

  const patch: Record<string, unknown> = { aliases: [...aliases], raw }
  if (!keep.summary && drop.summary) {
    patch.summary = drop.summary
    patch.summary_status = drop.summary_status
    report.tookSummary = true
  }
  const { error: upErr } = await db.from('entities').update(patch).eq('id', keepId)
  if (upErr) return { error: `更新目标实体失败：${upErr.message}` }

  const { data: del } = await db.from('entities').delete().eq('id', dropId).select('id')
  if (!del?.length) return { error: '合并已完成但删除重复行失败（RLS 拒绝？）' }

  revalidatePath('/admin/entities')
  revalidatePath(`/world/${keepId}`)
  return { report }
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
