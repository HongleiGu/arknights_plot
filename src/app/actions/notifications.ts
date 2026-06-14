'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { chapterSlug } from '@/lib/chapterSlug'

export interface NotificationRow {
  id: number
  type: string           // 'reply' | 'mention'
  created_at: string
  read_at: string | null
  actor_name: string | null
  href: string | null    // permalink: page of the comment + #cmt-<id>
}

async function myUserId(supabase: SupabaseClient): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  return data?.id ?? null
}

export async function unreadNotificationCount(): Promise<number> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return 0
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', me)
    .is('read_at', null)
  return count ?? 0
}

export async function listNotifications(limit = 20): Promise<NotificationRow[]> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return []

  const { data: notifs } = await supabase
    .from('notifications')
    .select('id, type, created_at, read_at, actor_id, comment_id')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!notifs || notifs.length === 0) return []

  const actorIds = [...new Set(notifs.map(n => n.actor_id).filter((x): x is number => x != null))]
  const { data: actors } = actorIds.length
    ? await supabase.from('users').select('id, display_name').in('id', actorIds)
    : { data: [] as { id: number; display_name: string | null }[] }
  const actorMap = new Map((actors ?? []).map(a => [a.id, a.display_name]))

  const commentIds = [...new Set(notifs.map(n => n.comment_id).filter((x): x is number => x != null))]
  const linkMap = await resolveCommentLinks(supabase, commentIds)

  return notifs.map(n => ({
    id:         n.id,
    type:       n.type,
    created_at: n.created_at,
    read_at:    n.read_at ?? null,
    actor_name: n.actor_id != null ? (actorMap.get(n.actor_id) ?? null) : null,
    href:       n.comment_id != null ? (linkMap.get(n.comment_id) ?? null) : null,
  }))
}

export async function markNotificationRead(id: number): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', me)
    .is('read_at', null)
}

// ---- permalink resolution --------------------------------------------------
// A comment is reachable via its anchor. Map the anchor → the page that renders
// it, append #cmt-<id>; CommentThread auto-opens + scrolls to that comment.

const enc = encodeURIComponent

async function storyPath(supabase: SupabaseClient, storyId: number | null | undefined): Promise<string | null> {
  if (storyId == null) return null
  const { data } = await supabase.from('stories').select('category, name').eq('id', storyId).maybeSingle()
  return data ? `/${enc(data.category)}/${enc(data.name)}` : null
}

async function eventPath(supabase: SupabaseClient, eventId: number | null | undefined): Promise<string | null> {
  if (eventId == null) return null
  const { data: ev } = await supabase.from('events').select('story_id').eq('id', eventId).maybeSingle()
  const base = await storyPath(supabase, ev?.story_id)
  return base ? `${base}/event/${eventId}` : null
}

interface AnchorRow {
  comment_id: number
  node_id: number | null
  chapter_id: number | null
  story_id: number | null
  gadget_id: number | null
  event_id: number | null
  event_option_id: number | null
  text_chunk_id: number | null
  furniture_item_id: number | null
}

async function chapterPath(
  supabase: SupabaseClient,
  chapterId: number,
  nodeSeq?: number,
): Promise<string | null> {
  const { data: ch } = await supabase
    .from('chapters')
    .select('order_in_story, level_code, level_name, story_id')
    .eq('id', chapterId)
    .maybeSingle()
  if (!ch) return null
  const { data: st } = await supabase.from('stories').select('category, name').eq('id', ch.story_id).maybeSingle()
  if (!st) return null
  let query = ''
  if (nodeSeq != null) {
    // Which paginated page (PAGE_SIZE 100) holds this node?
    const { count } = await supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .is('branch_id', null)
      .lt('seq', nodeSeq)
    const page = Math.floor((count ?? 0) / 100) + 1
    if (page > 1) query = `?page=${page}`
  }
  return `/${enc(st.category)}/${enc(st.name)}/${enc(chapterSlug(ch))}${query}`
}

async function pathForAnchor(supabase: SupabaseClient, a: AnchorRow): Promise<string | null> {
  if (a.node_id != null) {
    const { data: node } = await supabase.from('nodes').select('seq, chapter_id').eq('id', a.node_id).maybeSingle()
    if (!node) return null
    return chapterPath(supabase, node.chapter_id, node.seq)
  }
  if (a.chapter_id != null) return chapterPath(supabase, a.chapter_id)
  if (a.event_option_id != null) {
    const { data: opt } = await supabase.from('event_options').select('event_id').eq('id', a.event_option_id).maybeSingle()
    return eventPath(supabase, opt?.event_id)
  }
  if (a.event_id != null) return eventPath(supabase, a.event_id)
  if (a.gadget_id != null) {
    const { data } = await supabase.from('gadgets').select('story_id').eq('id', a.gadget_id).maybeSingle()
    return storyPath(supabase, data?.story_id)
  }
  if (a.text_chunk_id != null) {
    const { data: tc } = await supabase.from('text_chunks').select('cluster_id').eq('id', a.text_chunk_id).maybeSingle()
    if (!tc) return null
    const { data: cl } = await supabase.from('text_clusters').select('story_id').eq('id', tc.cluster_id).maybeSingle()
    return storyPath(supabase, cl?.story_id)
  }
  if (a.furniture_item_id != null) {
    const { data } = await supabase.from('furniture_items').select('story_id').eq('id', a.furniture_item_id).maybeSingle()
    return storyPath(supabase, data?.story_id)
  }
  if (a.story_id != null) return storyPath(supabase, a.story_id)
  return null
}

async function resolveCommentLinks(
  supabase: SupabaseClient,
  commentIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (commentIds.length === 0) return out
  const { data: anchors } = await supabase
    .from('comment_anchors')
    .select('comment_id, node_id, chapter_id, story_id, gadget_id, event_id, event_option_id, text_chunk_id, furniture_item_id')
    .in('comment_id', commentIds)
  for (const a of (anchors ?? []) as AnchorRow[]) {
    const base = await pathForAnchor(supabase, a)
    if (base) out.set(a.comment_id, `${base}#cmt-${a.comment_id}`)
  }
  return out
}
