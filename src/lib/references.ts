// In-comment / board cross-references (AP-2 + AP-11): `@type/id` tokens that
// point at any uniquely-id'd entity, resolved to a label + link + preview.
//
//   @story/17  @chapter/402  @node/68725  @gadget/12  @event/3
//   @option/9  @text/55      @furniture/7 @user/5
//
// Server-side resolution (needs a supabase client).

import type { SupabaseClient } from '@supabase/supabase-js'
import { chapterSlug } from '@/lib/chapterSlug'

// Reference token → the correlation_members FK column it maps to. `user` has no
// member column (comment-mention only), so it's excluded here.
export const REF_TYPE_COL: Record<string, string> = {
  story: 'story_id',
  chapter: 'chapter_id',
  node: 'node_id',
  gadget: 'gadget_id',
  event: 'event_id',
  option: 'event_option_id',
  text: 'text_chunk_id',
  furniture: 'furniture_item_id',
  entity: 'entity_id',
  enemy: 'enemy_id',
  item: 'item_id',
}

const REF_RE = /@(story|chapter|node|gadget|event|option|text|furniture|entity|enemy|item|user)\/(\d+)/g

export interface ReferenceData {
  key: string            // "node/68725"
  type: string
  id: number
  label: string
  href: string | null
  preview: string | null
}

/** Unique `@type/id` tokens in a body, in first-seen order. */
export function parseReferences(body: string): { type: string; id: number; key: string }[] {
  const out: { type: string; id: number; key: string }[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(REF_RE)) {
    const type = m[1]
    const id = parseInt(m[2], 10)
    const key = `${type}/${id}`
    if (!seen.has(key)) { seen.add(key); out.push({ type, id, key }) }
  }
  return out
}

const enc = encodeURIComponent
function trunc(s: string | null | undefined, n = 120): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

type Row = Record<string, unknown>

/** Resolve `@type/id` tokens to label/href/preview. Unknown ids are dropped. */
export async function resolveReferences(
  supabase: SupabaseClient,
  refs: { type: string; id: number }[],
): Promise<ReferenceData[]> {
  if (refs.length === 0) return []
  const idsOf = (t: string) => [...new Set(refs.filter(r => r.type === t).map(r => r.id))]

  const fetchByIds = async (table: string, cols: string, ids: number[]): Promise<Row[]> =>
    ids.length ? (((await supabase.from(table).select(cols).in('id', ids)).data ?? []) as unknown as Row[]) : []

  // Stage 1 — direct entities.
  const [users, storiesD, chaptersD, gadgets, eventsD, nodes, textChunks, options, furniture] = await Promise.all([
    fetchByIds('users', 'id, display_name', idsOf('user')),
    fetchByIds('stories', 'id, category, name, name_en, description', idsOf('story')),
    fetchByIds('chapters', 'id, story_id, level_code, level_name, order_in_story', idsOf('chapter')),
    fetchByIds('gadgets', 'id, story_id, name, effect, description', idsOf('gadget')),
    fetchByIds('events', 'id, story_id, name, intro', idsOf('event')),
    fetchByIds('nodes', 'id, chapter_id, seq, speaker, content', idsOf('node')),
    fetchByIds('text_chunks', 'id, cluster_id, title, body', idsOf('text')),
    fetchByIds('event_options', 'id, event_id, label, description, outcome', idsOf('option')),
    fetchByIds('furniture_items', 'id, story_id, name, description', idsOf('furniture')),
  ])
  // World-graph entities (026) and the global catalogs (037) — none of these
  // have a story parent, so they skip the stage-2/3 parent resolution entirely.
  const [entitiesD, enemiesD, itemsD] = await Promise.all([
    fetchByIds('entities', 'id, type, name, name_en, summary, mention_count', idsOf('entity')),
    fetchByIds('enemies', 'id, name, code, description, kind, rank, debut', idsOf('enemy')),
    fetchByIds('items', 'id, name, description, usage_text, rarity, item_group', idsOf('item')),
  ])
  const entityMap = new Map(entitiesD.map(e => [e.id as number, e]))
  const enemyMap = new Map(enemiesD.map(e => [e.id as number, e]))
  const itemMap = new Map(itemsD.map(i => [i.id as number, i]))

  // Stage 2 — parents of the above.
  const extraChapterIds = nodes.map(n => n.chapter_id as number).filter(id => !idsOf('chapter').includes(id))
  const extraEventIds = options.map(o => o.event_id as number).filter(id => !idsOf('event').includes(id))
  const clusterIds = [...new Set(textChunks.map(t => t.cluster_id as number))]
  const [chaptersX, eventsX, clusters] = await Promise.all([
    fetchByIds('chapters', 'id, story_id, level_code, level_name, order_in_story', [...new Set(extraChapterIds)]),
    fetchByIds('events', 'id, story_id, name, intro', [...new Set(extraEventIds)]),
    fetchByIds('text_clusters', 'id, story_id', clusterIds),
  ])

  const chapterMap = new Map([...chaptersD, ...chaptersX].map(c => [c.id as number, c]))
  const eventMap = new Map([...eventsD, ...eventsX].map(e => [e.id as number, e]))
  const clusterMap = new Map(clusters.map(c => [c.id as number, c]))

  // Stage 3 — every story we need.
  const storyNeeded = new Set<number>(idsOf('story'))
  for (const c of chapterMap.values()) storyNeeded.add(c.story_id as number)
  for (const g of gadgets) storyNeeded.add(g.story_id as number)
  for (const e of eventMap.values()) storyNeeded.add(e.story_id as number)
  for (const f of furniture) storyNeeded.add(f.story_id as number)
  for (const cl of clusterMap.values()) storyNeeded.add(cl.story_id as number)
  const stories = await fetchByIds('stories', 'id, category, name, name_en, description', [...storyNeeded])

  const userMap = new Map(users.map(u => [u.id as number, u]))
  const gadgetMap = new Map(gadgets.map(g => [g.id as number, g]))
  const nodeMap = new Map(nodes.map(n => [n.id as number, n]))
  const textMap = new Map(textChunks.map(t => [t.id as number, t]))
  const optionMap = new Map(options.map(o => [o.id as number, o]))
  const furnitureMap = new Map(furniture.map(f => [f.id as number, f]))
  const storyMap = new Map([...storiesD, ...stories].map(s => [s.id as number, s]))

  const storyPath = (s: Row | undefined): string | null =>
    s ? `/${enc(s.category as string)}/${enc(s.name as string)}` : null
  const chapterHref = (c: Row | undefined): string | null => {
    const s = c ? storyMap.get(c.story_id as number) : undefined
    return s ? `${storyPath(s)}/${enc(chapterSlug(c as { order_in_story: number; level_code: string | null; level_name: string | null }))}` : null
  }

  const out: ReferenceData[] = []
  for (const r of refs) {
    const key = `${r.type}/${r.id}`
    const push = (label: string, href: string | null, preview: string | null) =>
      out.push({ key, type: r.type, id: r.id, label, href, preview })

    if (r.type === 'user') {
      const u = userMap.get(r.id); if (!u) continue
      const name = (u.display_name as string) ?? 'anon'
      push(name, null, `用户 ${name}`)
    } else if (r.type === 'story') {
      const s = storyMap.get(r.id); if (!s) continue
      push(s.name as string, storyPath(s), trunc(s.description as string) ?? (s.name_en as string) ?? null)
    } else if (r.type === 'chapter') {
      const c = chapterMap.get(r.id); const s = c ? storyMap.get(c.story_id as number) : undefined
      if (!c || !s) continue
      const label = [c.level_code, c.level_name].filter(Boolean).join(' ') || `#${c.id}`
      push(label, chapterHref(c), `${s.name} · ${label}`)
    } else if (r.type === 'node') {
      const n = nodeMap.get(r.id); const c = n ? chapterMap.get(n.chapter_id as number) : undefined
      if (!n || !c) continue
      const label = (n.speaker as string) || trunc(n.content as string, 18) || '台词'
      push(label, chapterHref(c), trunc(n.content as string, 160))
    } else if (r.type === 'gadget') {
      const g = gadgetMap.get(r.id); const s = g ? storyMap.get(g.story_id as number) : undefined
      if (!g || !s) continue
      push(g.name as string, storyPath(s), trunc((g.effect as string) || (g.description as string)) ?? (s.name as string))
    } else if (r.type === 'event') {
      const e = eventMap.get(r.id); const s = e ? storyMap.get(e.story_id as number) : undefined
      if (!e || !s) continue
      push(e.name as string, `${storyPath(s)}/event/${e.id}`, trunc(e.intro as string) ?? (s.name as string))
    } else if (r.type === 'option') {
      const o = optionMap.get(r.id); const e = o ? eventMap.get(o.event_id as number) : undefined
      const s = e ? storyMap.get(e.story_id as number) : undefined
      if (!o || !e || !s) continue
      const label = (o.label as string) || trunc(o.description as string, 18) || '选项'
      push(label, `${storyPath(s)}/event/${e.id}`, trunc((o.description as string) || (o.outcome as string), 160))
    } else if (r.type === 'text') {
      const t = textMap.get(r.id); const cl = t ? clusterMap.get(t.cluster_id as number) : undefined
      const s = cl ? storyMap.get(cl.story_id as number) : undefined
      if (!t || !cl || !s) continue
      const label = (t.title as string) || trunc(t.body as string, 18) || '文段'
      push(label, storyPath(s), trunc(t.body as string, 160))
    } else if (r.type === 'furniture') {
      const f = furnitureMap.get(r.id); const s = f ? storyMap.get(f.story_id as number) : undefined
      if (!f || !s) continue
      push(f.name as string, storyPath(s), trunc(f.description as string) ?? (s.name as string))
    } else if (r.type === 'enemy') {
      const e = enemyMap.get(r.id); if (!e) continue
      // Fall back to the classification when an enemy has no description —
      // 76 of them don't, and a blank preview reads as a broken chip.
      const preview = trunc(e.description as string)
        ?? ([e.rank, e.kind, e.debut].filter(Boolean).join(' · ') || null)
      push(e.name as string, `/enemies/${e.id}`, preview)
    } else if (r.type === 'item') {
      const i = itemMap.get(r.id); if (!i) continue
      const preview = trunc((i.description as string) || (i.usage_text as string))
        ?? ([i.rarity != null ? `★${i.rarity}` : null, i.item_group].filter(Boolean).join(' · ') || null)
      push(i.name as string, `/items/${i.id}`, preview)
    } else if (r.type === 'entity') {
      const e = entityMap.get(r.id); if (!e) continue
      const preview = trunc(e.summary as string)
        ?? `${e.type}${e.mention_count ? ` · ${e.mention_count} 次出场` : ''}`
      push(e.name as string, `/world/${e.id}`, preview)
    }
  }
  return out
}
