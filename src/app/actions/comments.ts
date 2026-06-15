'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstile } from '@/lib/turnstile'
import { parseReferences, resolveReferences, type ReferenceData } from '@/lib/references'

// Per-user rate limit for new comments (AP-8): max N in the trailing window.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

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
  // Moderation (014): when deleted, removed_by non-null = a mod removed it
  // (vs the author self-deleting), so the tombstone can differ.
  removed_by: number | null
  // Reactions (015): per-emoji tallies for this comment; `mine` = the caller
  // already reacted with that emoji.
  reactions: ReactionTally[]
  // Cross-references (AP-2): resolved @type/id tokens found in the body.
  references: ReferenceData[]
}

export interface ReactionTally {
  emoji: string
  count: number
  mine: boolean
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
    .select(COMMENT_COLS)
    .in('id', commentIds)
    .order('created_at', { ascending: true })
  return enrichComments(supabase, (comments ?? []) as RawCommentRow[], user)
}

// Columns selected for a comment row everywhere.
const COMMENT_COLS =
  'id, user_id, body, created_at, updated_at, deleted_at, removed_by, parent_comment_id, reply_to_comment_id'

interface RawCommentRow {
  id: number
  user_id: number
  body: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  removed_by: number | null
  parent_comment_id: number | null
  reply_to_comment_id: number | null
}

type Db = Awaited<ReturnType<typeof createClient>>

/**
 * Turn raw comment rows into CommentRow[]: author names, the @-mentioned
 * author, the caller's `mine`/ownership flags, and reaction tallies. The
 * passed set must be self-contained for reply_to resolution — callers pass a
 * root together with all of its replies.
 */
async function enrichComments(
  supabase: Db,
  comments: RawCommentRow[],
  user: { id: string } | null,
): Promise<CommentRow[]> {
  if (comments.length === 0) return []

  const userIds = [...new Set(comments.map(c => c.user_id))]
  const { data: users } = await supabase
    .from('users').select('id, clerk_id, display_name').in('id', userIds)
  const userMap = new Map((users ?? []).map(u => [u.id, u]))
  const nameById = new Map(comments.map(c => [c.id, userMap.get(c.user_id)?.display_name ?? null]))

  let myUserId: number | null = null
  if (user) {
    for (const u of userMap.values()) if (u.clerk_id === user.id) { myUserId = u.id; break }
    if (myUserId === null) {
      const { data: meRow } = await supabase
        .from('users').select('id').eq('clerk_id', user.id).maybeSingle()
      myUserId = meRow?.id ?? null
    }
  }

  const ids = comments.map(c => c.id)
  const { data: reactions } = await supabase
    .from('comment_reactions').select('comment_id, emoji, user_id').in('comment_id', ids)
  const reactionsByComment = new Map<number, Map<string, { count: number; mine: boolean }>>()
  for (const r of reactions ?? []) {
    let m = reactionsByComment.get(r.comment_id)
    if (!m) { m = new Map(); reactionsByComment.set(r.comment_id, m) }
    let t = m.get(r.emoji)
    if (!t) { t = { count: 0, mine: false }; m.set(r.emoji, t) }
    t.count++
    if (myUserId != null && r.user_id === myUserId) t.mine = true
  }
  const talliesFor = (id: number): ReactionTally[] => {
    const m = reactionsByComment.get(id)
    return m
      ? [...m.entries()]
          .map(([emoji, t]) => ({ emoji, count: t.count, mine: t.mine }))
          .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
      : []
  }

  // Resolve every distinct @type/id across the (live) bodies in one pass.
  const refKeys = new Map<string, { type: string; id: number }>()
  for (const c of comments) {
    if (c.deleted_at != null) continue
    for (const r of parseReferences(c.body)) refKeys.set(r.key, { type: r.type, id: r.id })
  }
  const resolvedRefs = await resolveReferences(supabase, [...refKeys.values()])
  const refByKey = new Map(resolvedRefs.map(r => [r.key, r]))
  const refsFor = (body: string): ReferenceData[] => {
    const seen = new Set<string>()
    const out: ReferenceData[] = []
    for (const r of parseReferences(body)) {
      const hit = refByKey.get(r.key)
      if (hit && !seen.has(r.key)) { seen.add(r.key); out.push(hit) }
    }
    return out
  }

  return comments.map(c => {
    const u = userMap.get(c.user_id)
    const deleted = c.deleted_at != null
    return {
      id:                    c.id,
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
      removed_by:            c.removed_by ?? null,
      reactions:             talliesFor(c.id),
      references:            deleted ? [] : refsFor(c.body),
    }
  })
}

export type CommentSort = 'newest' | 'oldest' | 'top'

/**
 * A page of TOP-LEVEL comments (sorted) plus all of their replies, for one
 * anchor. `offset`/`limit` page the roots; replies always travel with their
 * root. Returns the enriched comments and the total top-level count (so the
 * client knows whether a "load more" remains).
 */
export async function listCommentsPage(
  anchor: Anchor,
  sort: CommentSort,
  offset: number,
  limit: number,
): Promise<{ comments: CommentRow[]; totalRoots: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const [col, val] = anchorEntry(anchor)

  const { data: anchors } = await supabase.from('comment_anchors').select('comment_id').eq(col, val)
  const allIds = (anchors ?? []).map(a => a.comment_id)
  if (allIds.length === 0) return { comments: [], totalRoots: 0 }

  // Lightweight scan of top-level rows, for ordering + total.
  const { data: topLite } = await supabase
    .from('comments').select('id, created_at').in('id', allIds).is('parent_comment_id', null)
  const tops = (topLite ?? []) as { id: number; created_at: string }[]
  const totalRoots = tops.length
  if (totalRoots === 0) return { comments: [], totalRoots: 0 }

  let orderedIds: number[]
  if (sort === 'top') {
    const { data: rx } = await supabase
      .from('comment_reactions').select('comment_id').in('comment_id', tops.map(t => t.id))
    const counts = new Map<number, number>()
    for (const r of rx ?? []) counts.set(r.comment_id, (counts.get(r.comment_id) ?? 0) + 1)
    orderedIds = [...tops]
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || (a.created_at < b.created_at ? 1 : -1))
      .map(t => t.id)
  } else {
    const asc = sort === 'oldest'
    orderedIds = [...tops]
      .sort((a, b) => (a.created_at < b.created_at ? (asc ? -1 : 1) : (asc ? 1 : -1)))
      .map(t => t.id)
  }

  const pageRootIds = orderedIds.slice(offset, offset + limit)
  if (pageRootIds.length === 0) return { comments: [], totalRoots }

  const [{ data: roots }, { data: replies }] = await Promise.all([
    supabase.from('comments').select(COMMENT_COLS).in('id', pageRootIds),
    supabase.from('comments').select(COMMENT_COLS).in('parent_comment_id', pageRootIds),
  ])
  const raw = [...(roots ?? []), ...(replies ?? [])] as RawCommentRow[]
  const enriched = await enrichComments(supabase, raw, user)
  return { comments: enriched, totalRoots }
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
  opts: { parentId?: number; replyToId?: number; turnstileToken?: string } = {},
): Promise<{ ok: true; comment: CommentRow } | { ok: false; error: string }> {
  body = body.trim()
  if (!body) return { ok: false, error: 'empty body' }
  if (body.length > 4000) return { ok: false, error: 'body too long (max 4000)' }

  // Anti-bot (no-op until Turnstile is configured).
  if (!(await verifyTurnstile(opts.turnstileToken))) {
    return { ok: false, error: '人机验证失败，请重试' }
  }

  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()

  // Per-user rate limit: cap new comments in the trailing window.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count: recent } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if ((recent ?? 0) >= RATE_MAX) {
    return { ok: false, error: '发言过于频繁，请稍后再试' }
  }
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

  const references = await resolveReferences(supabase, parseReferences(comment.body))

  // Resolve the @-mentioned comment's author for the returned row, and notify
  // them that they were replied to / mentioned (016).
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

    // Don't notify yourself; type distinguishes a direct reply to a top-level
    // comment from an @-mention of a sibling reply.
    if (ref?.user_id != null && ref.user_id !== userId) {
      const type = comment.reply_to_comment_id === comment.parent_comment_id ? 'reply' : 'mention'
      await supabase.from('notifications').insert({
        user_id:    ref.user_id,
        actor_id:   userId,
        type,
        comment_id: comment.id,
      })
    }
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
      removed_by:            null,
      reactions:             [],
      references,
    },
  }
}

/**
 * Toggle the caller's reaction with `emoji` on a comment: add it if absent,
 * remove it if present. Returns the resulting state (`reacted`). The
 * UNIQUE(comment_id, user_id, emoji) constraint makes a concurrent double-add
 * a no-op (23505 → treat as reacted).
 */
export async function toggleReaction(
  commentId: number,
  emoji: string,
): Promise<{ ok: true; reacted: boolean } | { ok: false; error: string }> {
  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('comment_reactions')
    .select('id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase.from('comment_reactions').delete().eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true, reacted: false }
  }

  const { error } = await supabase
    .from('comment_reactions')
    .insert({ comment_id: commentId, user_id: userId, emoji })
  if (error && error.code !== '23505') return { ok: false, error: error.message }
  return { ok: true, reacted: true }
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

// ---- moderation (014) ------------------------------------------------------

/** The caller's users.id + is_admin, or null if not signed in / no row yet. */
async function currentUser(): Promise<{ id: number; is_admin: boolean } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('id, is_admin')
    .eq('clerk_id', user.id)
    .maybeSingle()
  return data ? { id: data.id, is_admin: !!data.is_admin } : null
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const u = await currentUser()
  return !!u?.is_admin
}

/**
 * File a report against a comment. One per (comment, reporter); re-reporting
 * hits the UNIQUE constraint and is treated as a success (idempotent).
 */
export async function reportComment(
  commentId: number,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await ensureUserRow()
  if (userId === null) return { ok: false, error: 'not signed in' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('comment_reports')
    .insert({ comment_id: commentId, reporter_id: userId, reason: reason.trim() || null })
  if (error && error.code !== '23505') return { ok: false, error: error.message } // 23505 = already reported
  return { ok: true }
}

/**
 * Admin: remove any comment — soft-delete (like 013) but stamps removed_by so
 * the tombstone reads as a mod removal. RLS ("admin moderate") is the real
 * gate; the is_admin check here just gives a clean error.
 */
export async function modRemoveComment(
  commentId: number,
): Promise<{ ok: true; deleted_at: string; removed_by: number } | { ok: false; error: string }> {
  const me = await currentUser()
  if (!me) return { ok: false, error: 'not signed in' }
  if (!me.is_admin) return { ok: false, error: 'not an admin' }

  const supabase = await createClient()
  const deleted_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('comments')
    .update({ deleted_at, removed_by: me.id, body: '' })
    .eq('id', commentId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not found' }
  revalidatePath('/mod', 'page')
  return { ok: true, deleted_at, removed_by: me.id }
}

export interface ReportRow {
  id: number
  reason: string | null
  created_at: string
  reporter_name: string | null
  comment_id: number
  comment_body: string
  comment_deleted: boolean
  comment_author: string | null
}

/** Admin: unresolved reports for the mod queue (empty for non-admins). */
export async function listOpenReports(): Promise<ReportRow[]> {
  const me = await currentUser()
  if (!me?.is_admin) return []

  const supabase = await createClient()
  const { data: reports } = await supabase
    .from('comment_reports')
    .select('id, reason, created_at, reporter_id, comment_id')
    .is('resolved_at', null)
    .order('created_at', { ascending: true })
  if (!reports || reports.length === 0) return []

  const commentIds = [...new Set(reports.map(r => r.comment_id))]
  const { data: comments } = await supabase
    .from('comments')
    .select('id, body, deleted_at, user_id')
    .in('id', commentIds)
  const cMap = new Map((comments ?? []).map(c => [c.id, c]))

  const authorIds = (comments ?? []).map(c => c.user_id)
  const reporterIds = reports.map(r => r.reporter_id)
  const { data: users } = await supabase
    .from('users')
    .select('id, display_name')
    .in('id', [...new Set([...reporterIds, ...authorIds])])
  const uMap = new Map((users ?? []).map(u => [u.id, u.display_name]))

  return reports.map(r => {
    const c = cMap.get(r.comment_id)
    return {
      id:              r.id,
      reason:          r.reason,
      created_at:      r.created_at,
      reporter_name:   uMap.get(r.reporter_id) ?? null,
      comment_id:      r.comment_id,
      comment_body:    c ? (c.deleted_at ? '' : c.body) : '',
      comment_deleted: !!c?.deleted_at,
      comment_author:  c ? (uMap.get(c.user_id) ?? null) : null,
    }
  })
}

/** Admin: mark a report resolved. */
export async function resolveReport(
  reportId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await currentUser()
  if (!me) return { ok: false, error: 'not signed in' }
  if (!me.is_admin) return { ok: false, error: 'not an admin' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('comment_reports')
    .update({ resolved_at: new Date().toISOString(), resolved_by: me.id })
    .eq('id', reportId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/mod', 'page')
  return { ok: true }
}
