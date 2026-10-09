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

export interface MergeCandidate {
  keepId: number
  keepName: string
  keepLines: number
  dropId: number
  dropName: string
  dropLines: number
  /** Why these two look like one character. */
  basis: string
  /**
   * Which of the two things this is, and therefore which action is right.
   *
   * 'alt'      an 异格 — it has its OWN official 人员档案 and 客观履历, emphasising
   *            different aspects of the same person. Linking as 同一人 keeps both
   *            records; merging would discard one. Recommended: link.
   * 'nickname' a name that only ever appeared in dialogue, with no official
   *            record of its own. One character, two rows. Recommended: merge.
   */
  kind: 'alt' | 'nickname'
}

/**
 * Pairs that look like the same character, on grounded evidence only.
 *
 * Two signals, both from official text rather than from similarity:
 *  1. one name CONTAINS the other — 荒芜拉普兰德 ⊃ 拉普兰德, which is how the game
 *     names an operator's alternate form;
 *  2. and the longer one's official 客观履历 opens by naming the shorter one
 *     ("拉普兰德，无业，叙拉古萨卢佐家族现任家主阿尔贝托的独女…" on 荒芜拉普兰德's row).
 *
 * Signal 2 is what makes this more than string matching: 夜莺 contains 莺 by
 * accident, but no 客观履历 introduces it as 莺. Containment alone is offered
 * when there is no summary to check, marked as the weaker basis.
 */
export async function findMergeCandidates(): Promise<
  { candidates: MergeCandidate[] } | { error: string }
> {
  const bad = await guard()
  if (bad) return { error: bad }
  const db = await createClient()

  const rows: {
    id: number; name: string; summary: string | null
    mention_count: number; raw: Record<string, unknown> | null
  }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('entities')
      .select('id, name, summary, mention_count, raw')
      .eq('type', 'character').range(from, from + 999)
    const got = (data ?? []) as typeof rows
    rows.push(...got)
    if (got.length < 1000) break
  }
  // The documentary discriminator for alt-form vs nickname: does the game keep a
  // separate record for this name? Measured: all 17 alt forms have one, and
  // every nickname candidate has none.
  const hasRecord = (r: typeof rows[number]) =>
    (r.raw ?? {})['source'] === 'personnel_file/客观履历'

  // Only pairs where the longer name's own official 客观履历 OPENS BY NAMING the
  // shorter one. Containment alone is useless here: it yields 4,810 pairs, led
  // by 曼弗雷德→雷德 and 华法琳→法琳, and offering those as one-click irreversible
  // merges would be actively dangerous.
  //
  // Two traps, both found by running it:
  //  - a summary starting with the LONG name trivially starts with its own
  //    prefix, so 幽灵鲨 "matched" 幽灵 and 薇薇安娜 "matched" 薇薇安. Excluded by
  //    requiring the summary NOT to open with the long name.
  //  - several base names can match at once — 归溟幽灵鲨's summary opens "幽灵鲨，"
  //    which starts with both 幽灵鲨 and 幽灵 — so only the LONGEST match is kept.
  //
  // A boundary check on the next character was tried instead and is wrong:
  // 百炼嘉维尔's summary runs "嘉维尔现在仍是…" with no punctuation, and that is a
  // true pair.
  const best = new Map<number, { short: typeof rows[number]; long: typeof rows[number] }>()
  for (const long of rows) {
    if (long.name.length < 3) continue
    const summary = long.summary ?? ''
    if (!summary || summary.startsWith(long.name)) continue
    for (const short of rows) {
      if (short.id === long.id || short.name.length < 2) continue
      if (!long.name.includes(short.name)) continue
      if (!summary.startsWith(short.name)) continue
      const held = best.get(long.id)
      if (!held || short.name.length > held.short.name.length) {
        best.set(long.id, { short, long })
      }
    }
  }

  const out: MergeCandidate[] = [...best.values()].map(({ short, long }) => ({
    // The base form is the one to keep or link to: it is the name the rest of
    // the canon uses, and it carries the dialogue history (an alt form has none).
    keepId: short.id, keepName: short.name, keepLines: short.mention_count,
    dropId: long.id, dropName: long.name, dropLines: long.mention_count,
    basis: `「${long.name}」的官方客观履历开头即称其为「${short.name}」`
      + (hasRecord(long) ? '；它有自己的人员档案，所以是异格而不是昵称' : ''),
    kind: hasRecord(long) ? 'alt' : 'nickname',
  }))

  // Nicknames: a name that only appeared in dialogue, abbreviating one that has
  // an official record. PREFIX containment, not containment — that is what
  // running it taught: of 6 containment pairs, 4 were suffix coincidences
  // (安娜 from 薇薇安娜, 瑟琳 from 凯瑟琳, 威尔 from 诺威尔, 法琳 from 华法琳), and a
  // Chinese transliteration's ending carries no relationship at all. An
  // abbreviation keeps the start: 幽灵 of 幽灵鲨, 薇薇安 of 薇薇安娜.
  for (const short of rows) {
    if (hasRecord(short) || short.name.length < 2) continue
    for (const long of rows) {
      if (long.id === short.id || !hasRecord(long)) continue
      if (!long.name.startsWith(short.name)) continue
      if (short.mention_count > long.mention_count * 0.5) continue
      out.push({
        keepId: long.id, keepName: long.name, keepLines: long.mention_count,
        dropId: short.id, dropName: short.name, dropLines: short.mention_count,
        basis: `「${short.name}」是「${long.name}」的前缀、台词少得多、且没有自己的人员档案`,
        kind: 'nickname',
      })
    }
  }

  out.sort((a, b) => b.keepLines - a.keepLines)
  return { candidates: out }
}

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
