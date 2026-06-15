// In-comment cross-references (AP-2): `@type/id` tokens that point at any
// uniquely-id'd entity, resolved to a label + link + preview snippet.
//
//   @user/5   @story/17   @chapter/402   @gadget/12   @event/3
//
// Server-side resolution (needs a supabase client). The parsed tokens are
// attached to each comment so the client can render preview chips.

import type { SupabaseClient } from '@supabase/supabase-js'
import { chapterSlug } from '@/lib/chapterSlug'

export const REFERENCE_TYPES = ['user', 'story', 'chapter', 'gadget', 'event'] as const
const REF_RE = /@(user|story|chapter|gadget|event)\/(\d+)/g

export interface ReferenceData {
  key: string            // "story/17"
  type: string
  id: number
  label: string
  href: string | null    // internal link target, or null (e.g. users have no page)
  preview: string | null // short snippet shown in the hover card
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

/** Resolve `@type/id` tokens to label/href/preview. Unknown ids are dropped. */
export async function resolveReferences(
  supabase: SupabaseClient,
  refs: { type: string; id: number }[],
): Promise<ReferenceData[]> {
  if (refs.length === 0) return []
  const idsOf = (t: string) => refs.filter(r => r.type === t).map(r => r.id)

  const userIds = idsOf('user')
  const chapterIds = idsOf('chapter')
  const gadgetIds = idsOf('gadget')
  const eventIds = idsOf('event')
  const storyIds = idsOf('story')

  const empty = Promise.resolve({ data: [] as Record<string, unknown>[] })
  const [usersRes, chaptersRes, gadgetsRes, eventsRes] = await Promise.all([
    userIds.length ? supabase.from('users').select('id, display_name').in('id', userIds) : empty,
    chapterIds.length ? supabase.from('chapters').select('id, story_id, level_code, level_name, order_in_story').in('id', chapterIds) : empty,
    gadgetIds.length ? supabase.from('gadgets').select('id, story_id, name, effect, description').in('id', gadgetIds) : empty,
    eventIds.length ? supabase.from('events').select('id, story_id, name, intro').in('id', eventIds) : empty,
  ])
  const users = usersRes.data ?? []
  const chapters = chaptersRes.data ?? []
  const gadgets = gadgetsRes.data ?? []
  const events = eventsRes.data ?? []

  const storyNeeded = new Set<number>(storyIds)
  for (const c of chapters) storyNeeded.add(c.story_id as number)
  for (const g of gadgets) storyNeeded.add(g.story_id as number)
  for (const e of events) storyNeeded.add(e.story_id as number)
  const { data: stories } = storyNeeded.size
    ? await supabase.from('stories').select('id, category, name, name_en, description').in('id', [...storyNeeded])
    : { data: [] as Record<string, unknown>[] }

  const userMap = new Map((users).map(u => [u.id as number, u]))
  const chapterMap = new Map((chapters).map(c => [c.id as number, c]))
  const gadgetMap = new Map((gadgets).map(g => [g.id as number, g]))
  const eventMap = new Map((events).map(e => [e.id as number, e]))
  const storyMap = new Map((stories ?? []).map(s => [s.id as number, s]))

  const storyPath = (s: { category: string; name: string } | undefined): string | null =>
    s ? `/${enc(s.category)}/${enc(s.name)}` : null

  const out: ReferenceData[] = []
  for (const r of refs) {
    const key = `${r.type}/${r.id}`

    if (r.type === 'user') {
      const u = userMap.get(r.id)
      if (!u) continue
      const name = (u.display_name as string) ?? 'anon'
      out.push({ key, type: r.type, id: r.id, label: name, href: null, preview: `用户 ${name}` })
    } else if (r.type === 'story') {
      const s = storyMap.get(r.id) as { category: string; name: string; name_en: string | null; description: string | null } | undefined
      if (!s) continue
      out.push({ key, type: r.type, id: r.id, label: s.name, href: storyPath(s), preview: trunc(s.description) ?? s.name_en ?? null })
    } else if (r.type === 'chapter') {
      const c = chapterMap.get(r.id)
      const s = c ? storyMap.get(c.story_id as number) as { category: string; name: string } | undefined : undefined
      if (!c || !s) continue
      const label = [c.level_code, c.level_name].filter(Boolean).join(' ') || `#${c.id}`
      out.push({ key, type: r.type, id: r.id, label, href: `${storyPath(s)}/${enc(chapterSlug(c as { order_in_story: number; level_code: string | null; level_name: string | null }))}`, preview: `${s.name} · ${label}` })
    } else if (r.type === 'gadget') {
      const g = gadgetMap.get(r.id)
      const s = g ? storyMap.get(g.story_id as number) as { category: string; name: string } | undefined : undefined
      if (!g || !s) continue
      out.push({ key, type: r.type, id: r.id, label: g.name as string, href: storyPath(s), preview: trunc((g.effect as string) || (g.description as string)) ?? s.name })
    } else if (r.type === 'event') {
      const e = eventMap.get(r.id)
      const s = e ? storyMap.get(e.story_id as number) as { category: string; name: string } | undefined : undefined
      if (!e || !s) continue
      out.push({ key, type: r.type, id: r.id, label: e.name as string, href: `${storyPath(s)}/event/${e.id}`, preview: trunc(e.intro as string) ?? s.name })
    }
  }
  return out
}
