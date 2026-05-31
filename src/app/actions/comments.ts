'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface CommentRow {
  id: number
  body: string
  created_at: string
  display_name: string | null
  is_mine: boolean
}

/**
 * What a comment pins to. Exactly one key, mirroring comment_anchors'
 * `exactly_one_anchor` CHECK (004 + 006 + 007: node / event_option / …).
 * node + event_option are used today; the rest are future-proof.
 */
export type Anchor =
  | { node_id: number }
  | { event_option_id: number }
  | { event_id: number }
  | { gadget_id: number }
  | { text_chunk_id: number }
  | { furniture_item_id: number }

// The single (column, value) pair of an anchor — used to filter and insert.
function anchorEntry(a: Anchor): [string, number] {
  const [k, v] = Object.entries(a)[0]
  return [k, v as number]
}

// Which route to revalidate after a write on this anchor kind.
function anchorRevalidatePath(a: Anchor): string {
  if ('event_option_id' in a || 'event_id' in a)
    return '/[category]/[story]/event/[event]'
  if ('text_chunk_id' in a || 'furniture_item_id' in a)
    return '/[category]/[story]'
  return '/[category]/[story]/[chapter]'
}

/**
 * Make sure a `users` row exists for the current auth session. Comments
 * FK user_id → users.id, but we don't auto-create that row on sign-up,
 * so do it lazily on first write. clerk_id is just the Supabase auth UID
 * (the column name is legacy).
 *
 * Returns the users.id, or null if the caller is not authenticated.
 */
async function ensureUserRow(): Promise<number | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', user.id)
    .maybeSingle()
  if (existing) return existing.id

  const { data: inserted, error } = await supabase
    .from('users')
    .insert({
      clerk_id:     user.id,
      display_name: (user.user_metadata?.display_name as string | undefined) ?? null,
    })
    .select('id')
    .single()
  if (error) return null
  return inserted.id
}

/**
 * List comments anchored to a single target (node / event option / …),
 * joined with the author's display_name. is_mine flags ownership for
 * delete-button rendering.
 */
export async function listCommentsFor(anchor: Anchor): Promise<CommentRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [col, val] = anchorEntry(anchor)

  // Three-step join because Supabase pgrest joins can be brittle with anchors:
  //   1. anchor rows for this target
  //   2. the comments those anchors point at
  //   3. the users behind those comments
  const { data: anchors } = await supabase
    .from('comment_anchors')
    .select('comment_id')
    .eq(col, val)
  const commentIds = (anchors ?? []).map(a => a.comment_id)
  if (commentIds.length === 0) return []

  const { data: comments } = await supabase
    .from('comments')
    .select('id, user_id, body, created_at')
    .in('id', commentIds)
    .order('created_at', { ascending: true })
  if (!comments) return []

  const userIds = [...new Set(comments.map(c => c.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, clerk_id, display_name')
    .in('id', userIds)
  const userMap = new Map((users ?? []).map(u => [u.id, u]))

  return comments.map(c => {
    const u = userMap.get(c.user_id)
    return {
      id:           c.id,
      body:         c.body,
      created_at:   c.created_at,
      display_name: u?.display_name ?? null,
      is_mine:      !!user && u?.clerk_id === user.id,
    }
  })
}

/**
 * Post a comment anchored to a target. Returns { ok, error?, comment? }.
 */
export async function addCommentTo(
  anchor: Anchor,
  body: string,
): Promise<{ ok: true; comment: CommentRow } | { ok: false; error: string }> {
  body = body.trim()
  if (!body) return { ok: false, error: 'empty body' }
  if (body.length > 4000) return { ok: false, error: 'body too long (max 4000)' }

  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const { data: comment, error: ce } = await supabase
    .from('comments')
    .insert({ user_id: userId, body })
    .select('id, body, created_at')
    .single()
  if (ce || !comment) return { ok: false, error: ce?.message ?? 'insert failed' }

  const { error: ae } = await supabase
    .from('comment_anchors')
    .insert({ comment_id: comment.id, ...anchor })
  if (ae) return { ok: false, error: ae.message }

  // We don't know the exact path; revalidate the route shape this anchor
  // kind lives on — Next handles all matches.
  revalidatePath(anchorRevalidatePath(anchor), 'page')

  const { data: u } = await supabase
    .from('users').select('display_name').eq('id', userId).single()

  return {
    ok: true,
    comment: {
      id:           comment.id,
      body:         comment.body,
      created_at:   comment.created_at,
      display_name: u?.display_name ?? null,
      is_mine:      true,
    },
  }
}

// ---- node-specific wrappers (keep the chapter reader call sites stable) ----

export async function listCommentsForNode(nodeId: number): Promise<CommentRow[]> {
  return listCommentsFor({ node_id: nodeId })
}

export async function addCommentToNode(
  nodeId: number,
  body: string,
): Promise<{ ok: true; comment: CommentRow } | { ok: false; error: string }> {
  return addCommentTo({ node_id: nodeId }, body)
}
