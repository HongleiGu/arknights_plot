'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface CommentRow {
  id: number
  body: string
  created_at: string
  display_name: string | null
  is_mine: boolean
  // Threading (012): parent_comment_id NULL = top-level; set = a reply
  // collapsed under that root. reply_to_* describe the @-mentioned comment.
  parent_comment_id: number | null
  reply_to_comment_id: number | null
  reply_to_display_name: string | null
  // Edit/soft-delete (013): updated_at drives the "edited" marker;
  // deleted_at non-null = tombstone (body blanked, row + replies kept).
  updated_at: string
  deleted_at: string | null
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
    .select('id, user_id, body, created_at, updated_at, deleted_at, parent_comment_id, reply_to_comment_id')
    .in('id', commentIds)
    .order('created_at', { ascending: true })
  if (!comments) return []

  const userIds = [...new Set(comments.map(c => c.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, clerk_id, display_name')
    .in('id', userIds)
  const userMap = new Map((users ?? []).map(u => [u.id, u]))

  // id → author display_name, used to resolve the @-mentioned comment's
  // author. A reply_to target always shares this anchor (replies get an
  // anchor row too), so it's already in `comments`.
  const nameById = new Map(
    comments.map(c => [c.id, userMap.get(c.user_id)?.display_name ?? null]),
  )

  return comments.map(c => {
    const u = userMap.get(c.user_id)
    const deleted = c.deleted_at != null
    return {
      id:                    c.id,
      // Don't ship deleted bodies to the client — render a tombstone.
      body:                  deleted ? '' : c.body,
      created_at:            c.created_at,
      display_name:          u?.display_name ?? null,
      is_mine:               !!user && u?.clerk_id === user.id,
      parent_comment_id:     c.parent_comment_id ?? null,
      reply_to_comment_id:   c.reply_to_comment_id ?? null,
      reply_to_display_name: c.reply_to_comment_id != null
        ? nameById.get(c.reply_to_comment_id) ?? null
        : null,
      updated_at:            c.updated_at,
      deleted_at:            c.deleted_at ?? null,
    }
  })
}

/**
 * Post a comment anchored to a target. Returns { ok, error?, comment? }.
 *
 * `opts.parentId` makes this a reply collapsed under that thread root
 * (must be a top-level comment); `opts.replyToId` is the specific comment
 * being @-mentioned (root or sibling reply). Omit both for a top-level
 * comment.
 */
export async function addCommentTo(
  anchor: Anchor,
  body: string,
  opts: { parentId?: number; replyToId?: number } = {},
): Promise<{ ok: true; comment: CommentRow } | { ok: false; error: string }> {
  body = body.trim()
  if (!body) return { ok: false, error: 'empty body' }
  if (body.length > 4000) return { ok: false, error: 'body too long (max 4000)' }

  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const { data: comment, error: ce } = await supabase
    .from('comments')
    .insert({
      user_id: userId,
      body,
      parent_comment_id:   opts.parentId ?? null,
      reply_to_comment_id: opts.replyToId ?? null,
    })
    .select('id, body, created_at, updated_at, deleted_at, parent_comment_id, reply_to_comment_id')
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

  // Resolve the @-mentioned comment's author for the returned row.
  let replyToName: string | null = null
  if (comment.reply_to_comment_id != null) {
    const { data: ref } = await supabase
      .from('comments')
      .select('user_id, users:user_id (display_name)')
      .eq('id', comment.reply_to_comment_id)
      .maybeSingle()
    // users:user_id is a 1-row embed; pgrest may type it as object or array.
    const embed = ref?.users as { display_name: string | null } | { display_name: string | null }[] | null
    replyToName = Array.isArray(embed) ? embed[0]?.display_name ?? null : embed?.display_name ?? null
  }

  return {
    ok: true,
    comment: {
      id:                    comment.id,
      body:                  comment.body,
      created_at:            comment.created_at,
      display_name:          u?.display_name ?? null,
      is_mine:               true,
      parent_comment_id:     comment.parent_comment_id ?? null,
      reply_to_comment_id:   comment.reply_to_comment_id ?? null,
      reply_to_display_name: replyToName,
      updated_at:            comment.updated_at,
      deleted_at:            comment.deleted_at ?? null,
    },
  }
}

/**
 * Edit one of the caller's own comments. Owner enforcement is the RLS
 * "auth update" policy; we also filter by user_id so a non-owner update
 * affects zero rows (returns an error rather than silently succeeding).
 */
export async function editComment(
  id: number,
  body: string,
): Promise<{ ok: true; body: string; updated_at: string } | { ok: false; error: string }> {
  body = body.trim()
  if (!body) return { ok: false, error: 'empty body' }
  if (body.length > 4000) return { ok: false, error: 'body too long (max 4000)' }

  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('comments')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('body, updated_at')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not found or not yours' }
  return { ok: true, body: data.body, updated_at: data.updated_at }
}

/**
 * Soft-delete one of the caller's own comments: stamp deleted_at, blank the
 * body (so the content is actually gone), and keep the row + its replies so
 * the thread structure survives as a "[deleted]" tombstone. Admin/mod removal
 * of others' comments is AP-4.
 */
export async function deleteComment(
  id: number,
): Promise<{ ok: true; deleted_at: string } | { ok: false; error: string }> {
  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const deleted_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('comments')
    .update({ deleted_at, body: '' })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not found or not yours' }
  return { ok: true, deleted_at }
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
