'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { aiGuard, aiComplete, recordSpend } from '@/lib/ai/spend'

// Grounded relation extraction (AP-22 P2). Reads a story's curated descriptions
// / summaries (cheap, AP-23) + its character roster (seeded entities), and asks
// the model to extract ONLY relationships supported by that internal text,
// using ONLY names from the roster. Every edge is cited (@story/id) and marked
// source='ai'. Never pretraining.

const RELATION_SYS = `你是「明日方舟」剧情关系抽取助手。给你一部剧情的角色清单与剧情信息（梗概/章节简介），抽取这些角色之间「有文本支撑」的关系。
规则：
- from 和 to 必须都来自给定的角色清单，逐字一致；不得引入清单外的名字，不得臆造关系。
- kind 为简短中文关系词（如 盟友/敌对/上下级/同一势力/亲属/师徒/恋慕/同一人/旧识 等）。
- note 用一句话给出依据（源自所给信息）。
- 只输出 JSON 数组，形如 [{"from":"A","to":"B","kind":"盟友","note":"…"}]，不要任何多余文字、解释或代码块标记。
- 没有可靠依据的关系不要输出。`

// Kinds where direction doesn't matter — canonicalise to id-ascending to avoid
// storing both (A,B) and (B,A).
const SYMMETRIC = new Set(['盟友', '敌对', '亲属', '同一人', '恋人', '恋慕', '朋友', '旧识', '同僚', '同伴', '同一势力'])

type RelRow = {
  from_entity_id: number
  to_entity_id: number
  kind: string
  note: string | null
  source: string
  source_refs: string[]
  confidence: number
}

export interface RelationStatus {
  story: { id: number; name: string } | null
  character_count: number
  relation_count: number
}

/** Roster of seeded character entities that actually speak in this story, ranked. */
async function storyCharacters(
  db: Awaited<ReturnType<typeof createClient>>, chIds: number[],
): Promise<{ names: string[]; nameToId: Map<string, number> }> {
  const speakerCount = new Map<string, number>()
  let start = 0
  for (;;) {
    const { data } = await db.from('nodes').select('speaker').in('chapter_id', chIds).eq('type', 'speech').range(start, start + 999)
    if (!data || data.length === 0) break
    for (const n of data) { const s = (n.speaker ?? '').trim(); if (s) speakerCount.set(s, (speakerCount.get(s) ?? 0) + 1) }
    if (data.length < 1000) break
    start += 1000
    if (start > 8000) break
  }
  const ranked = [...speakerCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
  const { data: ents } = await db.from('entities').select('id, name').eq('type', 'character').in('name', ranked.slice(0, 60))
  const nameToId = new Map((ents ?? []).map(e => [e.name as string, e.id as number]))
  const names = ranked.filter(n => nameToId.has(n)).slice(0, 20) // top present characters
  return { names, nameToId }
}

export async function getRelationStatus(storyId: number): Promise<RelationStatus> {
  const db = await createClient()
  const { data: story } = await db.from('stories').select('id, name').eq('id', storyId).maybeSingle()
  if (!story) return { story: null, character_count: 0, relation_count: 0 }
  const { data: chs } = await db.from('chapters').select('id').eq('story_id', storyId)
  const chIds = (chs ?? []).map(c => c.id)
  const { names } = chIds.length ? await storyCharacters(db, chIds) : { names: [] as string[] }
  const { count } = await db.from('entity_relations')
    .select('id', { count: 'exact', head: true }).contains('source_refs', [`@story/${storyId}`])
  return { story: { id: story.id, name: story.name }, character_count: names.length, relation_count: count ?? 0 }
}

export async function extractStoryRelations(storyId: number): Promise<{ ok: boolean; error?: string; found?: number; saved?: number }> {
  const g = await aiGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = g.db

  const { data: story } = await db.from('stories').select('id, name, description').eq('id', storyId).maybeSingle()
  if (!story) return { ok: false, error: '未找到该剧情' }
  const { data: chs } = await db.from('chapters').select('id, level_code, level_name, order_in_story').eq('story_id', storyId).order('order_in_story')
  const chIds = (chs ?? []).map(c => c.id)
  if (chIds.length === 0) return { ok: false, error: '该剧情没有章节' }

  const { names: chars, nameToId } = await storyCharacters(db, chIds)
  if (chars.length < 2) return { ok: false, error: '可识别角色不足（先 seed 实体，或该剧情角色太少）' }

  // Grounding: curated descriptions / summaries only (cheap, AP-23), capped.
  const { data: descs } = await db.from('chapter_descriptions').select('chapter_id, body').in('chapter_id', chIds)
  const { data: sums } = await db.from('content_summaries').select('story_id, chapter_id, summary')
    .or(`story_id.eq.${storyId},chapter_id.in.(${chIds.join(',')})`)
  const chDesc = new Map((descs ?? []).map(d => [d.chapter_id as number, d.body as string]))
  const chSum = new Map<number, string>()
  for (const s of sums ?? []) if (s.chapter_id != null) chSum.set(s.chapter_id, s.summary)
  const storyOverview = story.description || (sums ?? []).find(s => s.story_id === storyId)?.summary || ''

  const parts: string[] = []
  if (storyOverview) parts.push(`梗概：${storyOverview}`)
  for (const c of chs ?? []) {
    const t = chDesc.get(c.id) ?? chSum.get(c.id)
    if (t) parts.push(`【${[c.level_code, c.level_name].filter(Boolean).join(' ')}】${t}`)
  }
  let grounding = parts.join('\n')
  if (!grounding.trim()) return { ok: false, error: '缺少可用于抽取的简介/摘要（先在 AP-23 生成，或补 description）' }
  if (grounding.length > 7000) grounding = grounding.slice(0, 7000)

  const userMsg = `剧情：《${story.name}》\n角色清单（只能用这些名字）：${chars.join('、')}\n\n可用剧情信息：\n${grounding}`
  const { text, usage } = await aiComplete(RELATION_SYS, userMsg)
  await recordSpend(db, g.id, usage)

  let parsed: { from?: string; to?: string; kind?: string; note?: string }[] = []
  try {
    const m = text.match(/\[[\s\S]*\]/)
    parsed = m ? JSON.parse(m[0]) : []
  } catch { return { ok: false, error: '解析模型输出失败' } }

  const rows: RelRow[] = []
  const seen = new Set<string>()
  for (const r of parsed) {
    const fromId = nameToId.get((r.from ?? '').trim())
    const toId = nameToId.get((r.to ?? '').trim())
    const kind = (r.kind ?? '').trim().slice(0, 40)
    if (!fromId || !toId || fromId === toId || !kind) continue
    let a = fromId, b = toId
    if (SYMMETRIC.has(kind) && a > b) { const t = a; a = b; b = t }
    const key = `${a}|${b}|${kind}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      from_entity_id: a, to_entity_id: b, kind,
      note: (r.note ?? '').toString().slice(0, 300) || null,
      source: 'ai', source_refs: [`@story/${storyId}`], confidence: 0.6,
    })
  }
  if (rows.length === 0) return { ok: true, found: parsed.length, saved: 0 }

  const { error } = await db.from('entity_relations').upsert(rows, { onConflict: 'from_entity_id,to_entity_id,kind' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ai')
  return { ok: true, found: parsed.length, saved: rows.length }
}
