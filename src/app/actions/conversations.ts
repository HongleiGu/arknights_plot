'use server'

// Saved / shared AI assistant sessions (AP-20). The live panel keeps its
// transcript in React state; these actions persist one so it can be linked,
// shared (owner/editor/viewer, exactly like AP-12 boards) and continued.
//
// Everything runs under the caller's own RLS — 030 decides who may read a
// conversation and who may append to it. Nothing here uses the service role.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type Db = Awaited<ReturnType<typeof createClient>>

export type ConversationVisibility = 'private' | 'unlisted' | 'public'
export type ConversationRole = 'owner' | 'editor' | 'viewer'

/** One persisted turn. `parts` is the assistant's tool trace, replayed verbatim. */
export interface ConversationTurn {
  id: number
  seq: number
  role: 'user' | 'assistant'
  content: string
  parts: unknown | null
  usage: unknown | null
  author_name: string | null
}

export interface ConversationSummary {
  id: number
  title: string
  visibility: ConversationVisibility
  board_id: number | null
  turn_count: number
  updated_at: string
  is_owner: boolean
  role: ConversationRole
}

export interface Conversation {
  id: number
  title: string
  visibility: ConversationVisibility
  board_id: number | null
  board_title: string | null
  is_owner: boolean
  my_role: ConversationRole | null
  can_edit: boolean
  updated_at: string
  turns: ConversationTurn[]
}

export interface ConversationCollaborator {
  user_id: number
  display_name: string | null
  role: 'viewer' | 'editor'
}

/** A turn as handed over by the client panel. */
export interface TurnInput {
  role: 'user' | 'assistant'
  content: string
  parts?: unknown
  usage?: unknown
}

async function myUserId(supabase: Db): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  return data?.id ?? null
}

/**
 * The caller's own sessions + sessions shared with them (each tagged with role).
 * Personal view like /boards: public sessions owned by others are not listed
 * here, only reachable by link. Empty when signed out.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return []

  const { data: mine } = await supabase
    .from('ai_conversations')
    .select('id, title, visibility, board_id, updated_at, created_by')
    .eq('created_by', me)
    .order('updated_at', { ascending: false })

  const { data: shares } = await supabase
    .from('ai_conversation_shares')
    .select('conversation_id, role')
    .eq('user_id', me)

  const sharedIds = (shares ?? []).map(s => s.conversation_id)
  const roleById = new Map((shares ?? []).map(s => [s.conversation_id, s.role as 'viewer' | 'editor']))

  let shared: NonNullable<typeof mine> = []
  if (sharedIds.length) {
    const { data } = await supabase
      .from('ai_conversations')
      .select('id, title, visibility, board_id, updated_at, created_by')
      .in('id', sharedIds)
      .order('updated_at', { ascending: false })
    shared = data ?? []
  }

  const rows = [...(mine ?? []), ...shared]
  if (rows.length === 0) return []

  // Turn counts in one grouped pass rather than a count query per row.
  const { data: msgs } = await supabase
    .from('ai_conversation_messages')
    .select('conversation_id')
    .in('conversation_id', rows.map(r => r.id))
  const counts = new Map<number, number>()
  for (const m of msgs ?? []) counts.set(m.conversation_id, (counts.get(m.conversation_id) ?? 0) + 1)

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    visibility: r.visibility as ConversationVisibility,
    board_id: r.board_id,
    turn_count: counts.get(r.id) ?? 0,
    updated_at: r.updated_at,
    is_owner: r.created_by === me,
    role: r.created_by === me ? 'owner' : (roleById.get(r.id) ?? 'viewer'),
  }))
}

/** Full transcript + the caller's effective role, or null if unreadable. */
export async function getConversation(id: number): Promise<Conversation | null> {
  const supabase = await createClient()
  const me = await myUserId(supabase)

  const { data: c } = await supabase
    .from('ai_conversations')
    .select('id, title, visibility, board_id, updated_at, created_by')
    .eq('id', id)
    .maybeSingle()
  if (!c) return null   // missing, or RLS says the caller can't read it

  const isOwner = me != null && c.created_by === me
  let myRole: ConversationRole | null = isOwner ? 'owner' : null
  if (!isOwner && me != null) {
    const { data: share } = await supabase
      .from('ai_conversation_shares')
      .select('role')
      .eq('conversation_id', id).eq('user_id', me).maybeSingle()
    if (share) myRole = share.role as ConversationRole
  }

  const { data: rows } = await supabase
    .from('ai_conversation_messages')
    .select('id, seq, role, content, parts, token_usage, author_id')
    .eq('conversation_id', id)
    .order('seq', { ascending: true })

  const authorIds = [...new Set((rows ?? []).map(r => r.author_id).filter((v): v is number => v != null))]
  const nameById = new Map<number, string | null>()
  if (authorIds.length) {
    const { data: users } = await supabase.from('users').select('id, display_name').in('id', authorIds)
    for (const u of users ?? []) nameById.set(u.id, u.display_name as string | null)
  }

  let boardTitle: string | null = null
  if (c.board_id != null) {
    const { data: b } = await supabase.from('correlations').select('title').eq('id', c.board_id).maybeSingle()
    boardTitle = b?.title ?? null
  }

  return {
    id: c.id,
    title: c.title,
    visibility: c.visibility as ConversationVisibility,
    board_id: c.board_id,
    board_title: boardTitle,
    is_owner: isOwner,
    my_role: myRole,
    can_edit: isOwner || myRole === 'editor',
    updated_at: c.updated_at,
    turns: (rows ?? []).map(r => ({
      id: r.id,
      seq: r.seq,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      parts: r.parts,
      usage: r.token_usage,
      author_name: r.author_id != null ? (nameById.get(r.author_id) ?? null) : null,
    })),
  }
}

/**
 * Insert turns starting at `startSeq`, stamped with the caller as author.
 * Returns null on success, or a user-facing message.
 */
async function insertTurns(
  supabase: Db, conversationId: number, authorId: number, startSeq: number, turns: TurnInput[],
): Promise<string | null> {
  if (turns.length === 0) return null
  const { error } = await supabase.from('ai_conversation_messages').insert(
    turns.map((t, i) => ({
      conversation_id: conversationId,
      seq: startSeq + i,
      role: t.role,
      content: t.content,
      parts: t.parts ?? null,
      token_usage: t.usage ?? null,
      author_id: authorId,
    })),
  )
  if (!error) return null
  // UNIQUE(conversation_id, seq): another collaborator appended between our
  // seq lookup and this insert. Distinguish it from a permission failure so
  // the UI can tell the user to reload rather than implying they lack access.
  if (error.code === '23505') return '有其他协作者刚刚追加了内容，请刷新后重试'
  return '无权限或写入失败'
}

/**
 * Persist a transcript as a new session. Title defaults to the first user turn
 * (trimmed), which is what the panel shows before the owner renames it.
 */
export async function createConversation(
  turns: TurnInput[],
  opts: { title?: string; boardId?: number | null } = {},
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return { ok: false, error: '未登录' }

  const firstUser = turns.find(t => t.role === 'user')?.content?.trim() ?? ''
  const title = (opts.title?.trim() || firstUser.slice(0, 60) || '未命名会话')

  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ created_by: me, title, board_id: opts.boardId ?? null })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? '创建失败' }

  const failed = await insertTurns(supabase, data.id, me, 0, turns)
  if (failed) return { ok: false, error: failed }
  revalidatePath('/ai')
  return { ok: true, id: data.id }
}

/** Append turns to an existing session (owner or editor; enforced by RLS). */
export async function appendTurns(
  conversationId: number, turns: TurnInput[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return { ok: false, error: '未登录' }

  const { data: last } = await supabase
    .from('ai_conversation_messages')
    .select('seq')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()
  const startSeq = (last?.seq ?? -1) + 1

  const failed = await insertTurns(supabase, conversationId, me, startSeq, turns)
  if (failed) return { ok: false, error: failed }
  // Owner-only under RLS; a no-op for editors, which is fine — the transcript
  // is the source of truth and updated_at is only used for list ordering.
  await supabase.from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  revalidatePath(`/ai/${conversationId}`)
  revalidatePath('/ai')
  return { ok: true }
}

export async function updateConversation(
  id: number,
  fields: { title?: string; visibility?: ConversationVisibility; boardId?: number | null },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title != null) patch.title = fields.title.trim() || '未命名会话'
  if (fields.visibility != null) patch.visibility = fields.visibility
  if (fields.boardId !== undefined) patch.board_id = fields.boardId
  // RLS: owner-only UPDATE, so an editor can't change visibility or re-title.
  const { error } = await supabase.from('ai_conversations').update(patch).eq('id', id)
  revalidatePath(`/ai/${id}`)
  return { ok: !error }
}

export async function deleteConversation(id: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
  revalidatePath('/ai')
  return { ok: !error }
}

// ---- sharing (same shape as boards.ts, backed by 030) ----------------------

/** Collaborators on a session (owner-only; RLS returns [] for non-owners). */
export async function listConversationCollaborators(id: number): Promise<ConversationCollaborator[]> {
  const supabase = await createClient()
  const { data: shares } = await supabase
    .from('ai_conversation_shares')
    .select('user_id, role')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
  if (!shares || shares.length === 0) return []
  const { data: users } = await supabase
    .from('users').select('id, display_name').in('id', shares.map(s => s.user_id))
  const nameById = new Map((users ?? []).map(u => [u.id, u.display_name as string | null]))
  return shares.map(s => ({
    user_id: s.user_id,
    display_name: nameById.get(s.user_id) ?? null,
    role: s.role as 'viewer' | 'editor',
  }))
}

const INVITE_ERRORS: Record<string, string> = {
  not_signed_in: '未登录',
  invalid_role: '角色无效',
  not_owner: '只有会话创建者可以邀请协作者',
  no_such_user: '没有找到使用该邮箱的用户',
  cannot_share_self: '不能邀请自己',
}

/** Invite by email (resolved server-side; users.email is client-hidden). */
export async function inviteConversationCollaborator(
  id: number, email: string, role: 'viewer' | 'editor',
): Promise<{ ok: true; collaborator: ConversationCollaborator } | { ok: false; error: string }> {
  email = email.trim()
  if (!email) return { ok: false, error: '请输入邮箱' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('share_ai_convo_by_email', {
    p_convo: id, p_email: email, p_role: role,
  })
  if (error) {
    const key = Object.keys(INVITE_ERRORS).find(k => error.message.includes(k))
    return { ok: false, error: key ? INVITE_ERRORS[key] : error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  revalidatePath(`/ai/${id}`)
  return {
    ok: true,
    collaborator: { user_id: row.user_id, display_name: row.display_name ?? null, role },
  }
}

export async function updateConversationCollaboratorRole(
  id: number, userId: number, role: 'viewer' | 'editor',
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('ai_conversation_shares')
    .update({ role })
    .eq('conversation_id', id)
    .eq('user_id', userId)
  return { ok: !error }
}

export async function removeConversationCollaborator(
  id: number, userId: number,
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('ai_conversation_shares')
    .delete()
    .eq('conversation_id', id)
    .eq('user_id', userId)
  return { ok: !error }
}
