'use server'

// Resolve what a speaker LABEL means inside one story (046).
//
// `entities.identity` (044) is global: may an edge attach to this vertex at all.
// Three shapes have no global answer, which is what this pass is for —
//
//   整合运动成员A   a ROLE. The stable fact is the ORGANISATION, and the
//                 occurrence is an anonymous member. 477 rows carry such a
//                 suffix across 196 stems, and 整合运动 / 深池 / 近卫局 / 黑钢 are
//                 not entities at all, because the book's 组织 chapter covers
//                 companies and plot-only factions are missing.
//   女儿           a RELATION. "Someone's daughter" is stable; whose depends on
//                 the scene, so the answer differs per story by definition.
//   蒙面人         a MASK. A character is behind it, revealed at a specific line.
//
// WHAT KEEPS THIS FROM BEING A PILE OF GUESSES
// --------------------------------------------
// The model is doing RESOLUTION, not invention, and three things are checked in
// code rather than asked for in the prompt:
//
//  1. **It may only cite a node it was shown.** Sample lines go in with their
//     `@node/<id>`, and a returned citation that is not in that set is dropped.
//     A model cannot fabricate evidence it was never given, and `046`'s
//     grounding CHECK refuses the row anyway if the citation is missing.
//  2. **`entity` must name a character row that already exists**, matched
//     exactly. It resolves against ALL character entities rather than this
//     story's cast, because that is precisely the mask case — 蒙面人 is someone
//     who may never speak under their own name here.
//  3. **`reason` is required by the table**, so a resolution with no stated
//     basis cannot be stored at all.
//
// `of_entity` is the one place the model may name something NEW, and only for a
// role: 整合运动 has to be creatable or the role case cannot be expressed. Such a
// row lands as an `organisation` with `review = 'suspicious'` and
// `raw.proposed_by = 'ai'` plus the citation, so it enters the same queue as
// everything else unvouched-for rather than arriving as settled fact.
//
// Everything is written `status = 'ai_draft'`. Fixing a wrong row is editing it.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { aiGuard, aiComplete, recordSpend } from '@/lib/ai/spend'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import type { SpeakerRoleRow, RoleKind } from '@/lib/graph'
import { ROLE_KINDS } from '@/lib/graph'

const SYS = `你是「明日方舟」剧情角色指代解析助手。给你一部剧情里的若干「说话人标签」，每个标签附带它在本剧情中的台词（每条台词带 @node/编号）。请判断每个标签在**这部剧情里**指的是什么。

kind 必须是下列之一：
- person      具体某个人，而且这个标签就是他/她的名字
- role        身份或归属（如「整合运动成员A」「医疗干员」）——每次出现都可能是不同的人
- relational  靠与别人的关系来指代（如「女儿」「师父」）——指谁取决于上下文
- mask        文本故意不直说是谁（如「蒙面人」「神秘的女性」），但能判断出是谁
- device      根本不是人（如「众人」「广播」「门外的声音」）

字段规则：
- entity：这个标签在本剧情里指的那个具体角色名。必须**逐字**来自给你的「已知角色」清单；不确定就填 null。device 必须填 null。
- of_entity：这个标签挂靠的对象——role 填它所属的组织（如「整合运动」），relational 填被指代关系的那一方（如「女儿」填她父亲/母亲的名字）。没有就填 null。role 的组织名可以不在清单里。
- reason：一句中文，说明依据。必须写，不能空。
- ref：**必须**是你所看到的台词编号之一，形如 @node/12345。不要写没给过你的编号。

只输出 JSON 数组，形如
[{"speaker":"女儿","kind":"relational","entity":null,"of_entity":"雷尔金","reason":"她称雷尔金为父亲","ref":"@node/12345"}]
不要任何多余文字、解释或代码块标记。无法判断的标签也要输出一行，kind 照实填，entity/of_entity 填 null。`

const PER_CALL = 18          // speakers per model call
const LINES_PER = 3          // sample lines shown per speaker
const LINE_CAP = 120         // characters per sample line

async function adminDb() {
  if (!(await isCurrentUserAdmin())) return null
  return createClient()
}

/** Existing resolutions for a story, for the review UI. */
export async function listSpeakerRoles(
  storyId: number,
): Promise<{ roles: SpeakerRoleRow[] } | { error: string }> {
  const db = await adminDb()
  if (!db) return { error: '无权限（仅管理员）' }

  const { data, error } = await db.from('speaker_roles')
    .select('id, speaker, kind, entity_id, of_entity_id, reason, source, source_refs, status')
    .eq('story_id', storyId)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { error: '迁移 046_speaker_roles.sql 还没应用' }
    }
    return { error: error.message }
  }
  const rows = (data ?? []) as {
    id: number; speaker: string; kind: string
    entity_id: number | null; of_entity_id: number | null
    reason: string; source: string; source_refs: string[]; status: string
  }[]

  const ids = [...new Set(rows.flatMap(r =>
    [r.entity_id, r.of_entity_id].filter((v): v is number => v != null)))]
  const names = new Map<number, string>()
  if (ids.length) {
    const { data: ents } = await db.from('entities').select('id, name, type').in('id', ids)
    for (const e of (ents ?? []) as { id: number; name: string; type: string }[]) {
      names.set(e.id, e.type === 'character' ? e.name : `${e.name}（${e.type}）`)
    }
  }
  return {
    roles: rows.map(r => ({
      id: r.id, speaker: r.speaker, kind: r.kind as RoleKind,
      entityId: r.entity_id, entityName: r.entity_id ? names.get(r.entity_id) ?? null : null,
      ofEntityId: r.of_entity_id,
      ofEntityName: r.of_entity_id ? names.get(r.of_entity_id) ?? null : null,
      reason: r.reason, source: r.source, sourceRefs: r.source_refs ?? [],
      status: r.status as SpeakerRoleRow['status'],
    })),
  }
}

export interface ResolveReport {
  asked: number
  returned: number
  written: number
  remaining: number
  createdOrgs: string[]
  dropped: { speaker: string; why: string }[]
}

/**
 * One chunk of a story's unresolved speakers. Call again while `remaining > 0`.
 *
 * Chunked rather than time-boxed because the cost here is one model call per
 * ~18 speakers and a big story has 154 of them (反常光谱) — a single call would
 * both blow the context and lose everything on one bad parse.
 */
export async function resolveStorySpeakers(
  storyId: number,
): Promise<{ report: ResolveReport } | { error: string }> {
  const g = await aiGuard()
  if ('error' in g) return { error: g.error }
  const db = g.db

  const { data: story } = await db.from('stories')
    .select('id, name').eq('id', storyId).maybeSingle()
  if (!story) return { error: '未找到该剧情' }

  const { data: existing, error: exErr } = await db.from('speaker_roles')
    .select('speaker').eq('story_id', storyId)
  if (exErr) {
    if (/does not exist|schema cache/i.test(exErr.message)) {
      return { error: '迁移 046_speaker_roles.sql 还没应用' }
    }
    return { error: exErr.message }
  }
  const done = new Set(((existing ?? []) as { speaker: string }[]).map(r => r.speaker))

  const { data: sp, error: spErr } = await db.rpc('scope_speakers', { p_story: storyId })
  if (spErr) return { error: spErr.message }
  const all = ((sp ?? []) as { speaker: string; lines: number }[])
    .filter(s => !done.has(s.speaker))
  if (!all.length) {
    return { report: { asked: 0, returned: 0, written: 0, remaining: 0,
                       createdOrgs: [], dropped: [] } }
  }
  // Batch selection walks PAST speakers with nothing citable rather than taking
  // the first PER_CALL blindly. Taking them blindly is a second live-lock: a
  // speaker whose every line is too short to quote can never be written (046
  // needs a citation), so it would be re-asked on every run and block the
  // speakers behind it. They are reported instead, and only ever by hand.
  const { data: chs0 } = await db.from('chapters').select('id').eq('story_id', storyId)
  const chIds = ((chs0 ?? []) as { id: number }[]).map(c => c.id)
  const batch: { speaker: string; lines: number }[] = []
  const uncitable: string[] = []
  const lines = new Map<string, { id: number; text: string }[]>()
  const allowedRefs = new Set<string>()
  for (const cand of all) {
    if (batch.length >= PER_CALL) break
    if (!chIds.length) break
    const { data } = await db.from('nodes')
      .select('id, content').in('chapter_id', chIds)
      .eq('speaker', cand.speaker).order('id').limit(LINES_PER * 3)
    const acc: { id: number; text: string }[] = []
    for (const n of (data ?? []) as { id: number; content: string | null }[]) {
      const t = (n.content ?? '').trim()
      if (t.length < 4) continue
      acc.push({ id: n.id, text: t.slice(0, LINE_CAP) })
      if (acc.length >= LINES_PER) break
    }
    if (!acc.length) { uncitable.push(cand.speaker); continue }
    for (const a of acc) allowedRefs.add(`@node/${a.id}`)
    lines.set(cand.speaker, acc)
    batch.push(cand)
  }
  if (!batch.length) {
    return { report: {
      asked: 0, returned: 0, written: 0, remaining: 0, createdOrgs: [],
      dropped: uncitable.map(s => ({ speaker: s, why: '没有可引用的台词，只能手工判定' })),
    } }
  }

  // Known characters: every character entity, so a mask can resolve to someone
  // who never speaks under their own name here. Capped and ranked, with this
  // story's own cast first so the useful names survive the cap.
  const castNames = ((sp ?? []) as { speaker: string }[]).map(s => s.speaker)
  const { data: castEnts } = await db.from('entities')
    .select('id, name').eq('type', 'character').eq('identity', 'named')
    .in('name', castNames)
  const { data: bigEnts } = await db.from('entities')
    .select('id, name').eq('type', 'character').eq('identity', 'named')
    .order('mention_count', { ascending: false }).limit(120)
  const known = new Map<string, number>()
  for (const e of [...((castEnts ?? []) as { id: number; name: string }[]),
                   ...((bigEnts ?? []) as { id: number; name: string }[])]) {
    known.set(e.name, e.id)
  }

  const { data: orgEnts } = await db.from('entities')
    .select('id, name, type').in('type', ['organisation', 'nation', 'place', 'race'])
  const anchors = new Map<string, number>()
  for (const e of (orgEnts ?? []) as { id: number; name: string; type: string }[]) {
    anchors.set(e.name, e.id)
  }

  const wanted = new Set(batch.map(b => b.speaker))

  const prompt = [
    `剧情：《${story.name}》`,
    `已知角色（entity 只能用这些名字，逐字一致）：${[...known.keys()].join('、')}`,
    `已知组织/地点/种族（of_entity 可以用这些，role 也可以写清单外的组织名）：${[...anchors.keys()].join('、')}`,
    '',
    '需要判断的说话人标签及其台词：',
    ...batch.map(b => {
      const ls = lines.get(b.speaker) ?? []
      return `【${b.speaker}】本剧情 ${b.lines} 行\n`
        + (ls.length
          ? ls.map(l => `  @node/${l.id}：${l.text}`).join('\n')
          : '  （没有可引用的台词）')
    }),
  ].join('\n')

  const { text, usage } = await aiComplete(SYS, prompt)
  await recordSpend(db, g.id, usage)

  let parsed: Record<string, unknown>[] = []
  try {
    const m = text.match(/\[[\s\S]*\]/)
    parsed = m ? JSON.parse(m[0]) : []
  } catch {
    return { error: '解析模型输出失败' }
  }

  const report: ResolveReport = {
    asked: batch.length, returned: parsed.length, written: 0,
    // The uncitable ones are not coming back, so they are not 'remaining'.
    remaining: all.length - batch.length - uncitable.length,
    createdOrgs: [],
    dropped: uncitable.map(sp => ({ speaker: sp, why: '没有可引用的台词，只能手工判定' })),
  }
  const str = (v: unknown) => typeof v === 'string' ? v.trim() : ''

  for (const r of parsed) {
    const speaker = str(r.speaker)
    const kind = str(r.kind) as RoleKind
    const reason = str(r.reason)
    const ref = str(r.ref)
    const drop = (why: string) => report.dropped.push({ speaker: speaker || '?', why })

    if (!wanted.has(speaker)) { drop('不是本批询问的标签'); continue }
    if (!ROLE_KINDS.includes(kind)) { drop(`未知 kind：${str(r.kind)}`); continue }
    if (!reason) { drop('没有给出依据'); continue }
    // The anti-fabrication check: a citation it was never shown is not evidence.
    if (!allowedRefs.has(ref)) { drop(`引用不在给它看过的台词里：${ref || '空'}`); continue }

    let entityId: number | null = null
    const entName = str(r.entity)
    if (entName && kind !== 'device') {
      entityId = known.get(entName) ?? null
      if (!entityId) { drop(`entity「${entName}」不在已知角色里`); continue }
    }

    let ofId: number | null = null
    const ofName = str(r.of_entity)
    if (ofName) {
      ofId = anchors.get(ofName) ?? known.get(ofName) ?? null
      if (!ofId && kind === 'role') {
        // The one place a new vertex may appear, and it arrives unvouched-for:
        // review='suspicious', with the citation that prompted it.
        const { data: made, error: mkErr } = await db.from('entities').insert({
          type: 'organisation', name: ofName, identity: 'named', review: 'suspicious',
          review_note: `由说话人「${speaker}」推出的组织，模型提出，待复核`,
          raw: { proposed_by: 'ai', from_speaker: speaker, story_id: storyId, refs: [ref] },
        }).select('id').maybeSingle()
        if (mkErr) { drop(`创建组织「${ofName}」失败：${mkErr.message}`); continue }
        ofId = made?.id ?? null
        if (ofId) { anchors.set(ofName, ofId); report.createdOrgs.push(ofName) }
      }
      if (!ofId) { drop(`of_entity「${ofName}」无法解析`); continue }
    }

    const { error: wErr } = await db.from('speaker_roles').upsert({
      story_id: storyId, speaker, kind,
      entity_id: kind === 'device' ? null : entityId,
      of_entity_id: ofId,
      reason: reason.slice(0, 500),
      source: 'ai', source_refs: [ref], status: 'ai_draft',
    }, { onConflict: 'story_id,speaker' })
    if (wErr) { drop(`写入失败：${wErr.message}`); continue }
    report.written++
  }

  revalidatePath('/admin/entities')
  return { report }
}

/** Edit or confirm one resolution. Fixing a wrong row is editing it. */
export async function updateSpeakerRole(
  id: number,
  patch: {
    kind?: RoleKind; entityId?: number | null; ofEntityId?: number | null
    reason?: string; status?: SpeakerRoleRow['status']
  },
): Promise<{ ok: true } | { error: string }> {
  const db = await adminDb()
  if (!db) return { error: '无权限（仅管理员）' }

  const body: Record<string, unknown> = {}
  if (patch.kind !== undefined) {
    if (!ROLE_KINDS.includes(patch.kind)) return { error: `未知 kind：${patch.kind}` }
    body.kind = patch.kind
  }
  if (patch.entityId !== undefined) body.entity_id = patch.entityId
  if (patch.ofEntityId !== undefined) body.of_entity_id = patch.ofEntityId
  if (patch.reason !== undefined) {
    if (!patch.reason.trim()) return { error: '依据不能为空' }
    body.reason = patch.reason.trim().slice(0, 500)
  }
  if (patch.status !== undefined) body.status = patch.status
  // A human editing this row makes it their claim, so it stops needing the
  // model's citation to satisfy 046's grounding CHECK.
  if (Object.keys(body).length) body.source = 'manual'
  else return { ok: true }

  const { data, error } = await db.from('speaker_roles')
    .update(body).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: '未写入任何行（RLS 拒绝或 id 不存在）' }

  revalidatePath('/admin/entities')
  return { ok: true }
}
