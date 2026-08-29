'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resolveReferences, REF_TYPE_COL, type ReferenceData } from '@/lib/references'

type Db = Awaited<ReturnType<typeof createClient>>

// Shared with @type/id references: token → member FK column, and back.
const TYPE_COL = REF_TYPE_COL
const COL_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(REF_TYPE_COL).map(([t, c]) => [c, t]),
)
const ENTITY_COLS = Object.keys(COL_TYPE)

export type BoardRole = 'owner' | 'editor' | 'viewer'
export type BoardVisibility = 'private' | 'unlisted' | 'public'

export interface BoardSummary {
  id: number
  title: string
  description: string | null
  layout: string
  visibility: BoardVisibility
  is_owner: boolean
  role: BoardRole
  member_count: number
}

export interface BoardCollaborator {
  user_id: number
  display_name: string | null
  role: 'viewer' | 'editor'
}

export interface BoardMember {
  id: number
  kind: 'entity' | 'card'
  x: number
  y: number
  seq: number
  title: string | null
  note: string | null
  data: unknown | null      // free-form custom data (018)
  ref: ReferenceData | null // resolved entity (label/href/preview), or null for cards
}

export interface BoardEdge {
  id: number
  from: number
  to: number
  label: string | null
  directed: boolean
  kind: string | null
}

export interface Board {
  id: number
  title: string
  description: string | null
  layout: string
  visibility: BoardVisibility
  is_owner: boolean
  my_role: BoardRole | null
  can_edit: boolean
  members: BoardMember[]
  edges: BoardEdge[]
}

async function myUserId(supabase: Db): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  return data?.id ?? null
}

/** Derive an entity ref {type,id} from a member row, or null for a card. */
function memberEntity(row: Record<string, unknown>): { type: string; id: number } | null {
  for (const col of ENTITY_COLS) {
    const v = row[col]
    if (v != null) return { type: COL_TYPE[col], id: v as number }
  }
  return null
}

/**
 * The caller's own boards + boards shared with them (each tagged with role).
 * Personal view, à la Google Docs — public boards owned by others are NOT
 * listed here (they're reachable by link / a future gallery). Empty when the
 * caller is signed out.
 */
export async function listBoards(): Promise<BoardSummary[]> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return []

  const { data: mine } = await supabase
    .from('correlations')
    .select('id, title, description, layout, visibility, created_by')
    .eq('created_by', me)
    .order('created_at', { ascending: false })

  const { data: shares } = await supabase
    .from('correlation_shares')
    .select('correlation_id, role')
    .eq('user_id', me)
  const shareRole = new Map<number, 'viewer' | 'editor'>()
  for (const s of shares ?? []) shareRole.set(s.correlation_id, s.role as 'viewer' | 'editor')

  type Row = { id: number; title: string; description: string | null; layout: string | null; visibility: string; created_by: number }
  let shared: Row[] = []
  if (shareRole.size) {
    const { data } = await supabase
      .from('correlations')
      .select('id, title, description, layout, visibility, created_by')
      .in('id', [...shareRole.keys()])
      .order('created_at', { ascending: false })
    shared = (data ?? []) as Row[]
  }

  const all = [...((mine ?? []) as Row[]), ...shared]
  if (all.length === 0) return []

  const ids = all.map(b => b.id)
  const { data: members } = await supabase
    .from('correlation_members').select('correlation_id').in('correlation_id', ids)
  const counts = new Map<number, number>()
  for (const m of members ?? []) counts.set(m.correlation_id, (counts.get(m.correlation_id) ?? 0) + 1)

  return all.map(b => ({
    id: b.id,
    title: b.title,
    description: b.description ?? null,
    layout: b.layout ?? 'board',
    visibility: (b.visibility ?? 'private') as BoardVisibility,
    is_owner: b.created_by === me,
    role: (b.created_by === me ? 'owner' : shareRole.get(b.id) ?? 'viewer') as BoardRole,
    member_count: counts.get(b.id) ?? 0,
  }))
}

export async function createBoard(
  title: string,
  description?: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  title = title.trim()
  if (!title) return { ok: false, error: '请输入标题' }
  const supabase = await createClient()
  const me = await myUserId(supabase)
  if (me == null) return { ok: false, error: 'not signed in' }
  // New boards start private (AP-12) — the owner opts into sharing explicitly.
  const { data, error } = await supabase
    .from('correlations')
    .insert({ title, description: description?.trim() || null, created_by: me, visibility: 'private' })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'create failed' }
  revalidatePath('/boards')
  return { ok: true, id: data.id }
}

export async function getBoard(id: number): Promise<Board | null> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  const { data: board } = await supabase
    .from('correlations')
    .select('id, title, description, layout, visibility, created_by')
    .eq('id', id)
    .maybeSingle()
  if (!board) return null

  // Resolve the caller's role: owner > share role > none.
  let my_role: BoardRole | null = null
  if (me != null) {
    if (board.created_by === me) {
      my_role = 'owner'
    } else {
      const { data: sh } = await supabase
        .from('correlation_shares')
        .select('role').eq('correlation_id', id).eq('user_id', me).maybeSingle()
      if (sh) my_role = sh.role as BoardRole
    }
  }
  const can_edit = my_role === 'owner' || my_role === 'editor'

  const { data: memberRows } = await supabase
    .from('correlation_members')
    .select('id, x, y, seq, title, note, data, ' + ENTITY_COLS.join(', '))
    .eq('correlation_id', id)
  const rows = (memberRows ?? []) as unknown as Record<string, unknown>[]

  // Resolve entity members (story/chapter/gadget/event) to labels/links.
  const refSpecs = rows.map(memberEntity).filter((x): x is { type: string; id: number } => !!x)
  const resolved = await resolveReferences(supabase, refSpecs)
  const refByKey = new Map(resolved.map(r => [r.key, r]))

  const members: BoardMember[] = rows.map(r => {
    const ent = memberEntity(r)
    return {
      id: r.id as number,
      kind: ent ? 'entity' : 'card',
      x: (r.x as number) ?? 0,
      y: (r.y as number) ?? 0,
      seq: (r.seq as number) ?? 0,
      title: (r.title as string) ?? null,
      note: (r.note as string) ?? null,
      data: (r.data as unknown) ?? null,
      ref: ent ? refByKey.get(`${ent.type}/${ent.id}`) ?? null : null,
    }
  })

  const { data: edgeRows } = await supabase
    .from('correlation_edges')
    .select('id, from_member, to_member, label, directed, kind')
    .eq('correlation_id', id)
  const edges: BoardEdge[] = (edgeRows ?? []).map(e => ({
    id: e.id, from: e.from_member, to: e.to_member, label: e.label ?? null, directed: !!e.directed, kind: e.kind ?? null,
  }))

  return {
    id: board.id,
    title: board.title,
    description: board.description ?? null,
    layout: board.layout ?? 'board',
    visibility: (board.visibility ?? 'private') as BoardVisibility,
    is_owner: me != null && board.created_by === me,
    my_role,
    can_edit,
    members,
    edges,
  }
}

export async function updateBoard(
  id: number,
  fields: { title?: string; description?: string; layout?: string; visibility?: BoardVisibility },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (fields.title != null) patch.title = fields.title.trim()
  if (fields.description != null) patch.description = fields.description.trim() || null
  if (fields.layout != null) patch.layout = fields.layout
  if (fields.visibility != null) patch.visibility = fields.visibility
  if (Object.keys(patch).length === 0) return { ok: true }
  // RLS: only the owner may UPDATE correlations, so visibility can't be
  // changed by an editor even though editors can mutate members/edges.
  const { error } = await supabase.from('correlations').update(patch).eq('id', id)
  return { ok: !error }
}

// ---- sharing (AP-12) -------------------------------------------------------

/** Collaborators on a board (owner-only; RLS returns [] for non-owners). */
export async function listCollaborators(boardId: number): Promise<BoardCollaborator[]> {
  const supabase = await createClient()
  const { data: shares } = await supabase
    .from('correlation_shares')
    .select('user_id, role')
    .eq('correlation_id', boardId)
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
  not_owner: '只有板主可以邀请协作者',
  no_such_user: '没有找到使用该邮箱的用户',
  cannot_share_self: '不能邀请自己',
}

/** Invite a user by email (resolved server-side; email is client-hidden). */
export async function inviteCollaborator(
  boardId: number,
  email: string,
  role: 'viewer' | 'editor',
): Promise<{ ok: true; collaborator: BoardCollaborator } | { ok: false; error: string }> {
  email = email.trim()
  if (!email) return { ok: false, error: '请输入邮箱' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('share_board_by_email', {
    p_board: boardId, p_email: email, p_role: role,
  })
  if (error) {
    const key = Object.keys(INVITE_ERRORS).find(k => error.message.includes(k))
    return { ok: false, error: key ? INVITE_ERRORS[key] : error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  revalidatePath(`/boards/${boardId}`)
  return {
    ok: true,
    collaborator: { user_id: row.user_id, display_name: row.display_name ?? null, role },
  }
}

export async function updateCollaboratorRole(
  boardId: number,
  userId: number,
  role: 'viewer' | 'editor',
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('correlation_shares')
    .update({ role })
    .eq('correlation_id', boardId)
    .eq('user_id', userId)
  return { ok: !error }
}

export async function removeCollaborator(boardId: number, userId: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('correlation_shares')
    .delete()
    .eq('correlation_id', boardId)
    .eq('user_id', userId)
  return { ok: !error }
}

export async function deleteBoard(id: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('correlations').delete().eq('id', id)
  revalidatePath('/boards')
  return { ok: !error }
}

async function nextPosition(supabase: Db, boardId: number): Promise<{ x: number; y: number }> {
  const { count } = await supabase
    .from('correlation_members').select('id', { count: 'exact', head: true }).eq('correlation_id', boardId)
  const n = count ?? 0
  return { x: (n % 4) * 240 + 40, y: Math.floor(n / 4) * 150 + 40 }
}

export async function addEntityMember(
  boardId: number,
  refInput: string,
): Promise<{ ok: true; member: BoardMember } | { ok: false; error: string }> {
  const m = refInput.trim().replace(/^@/, '').match(/^(\w+)\/(\d+)$/)
  if (!m) return { ok: false, error: '格式：type/ID，如 story/17' }
  const type = m[1]
  const id = parseInt(m[2], 10)
  const col = TYPE_COL[type]
  if (!col) return { ok: false, error: `不支持的类型：${type}（支持 ${Object.keys(TYPE_COL).join('/')}）` }

  const supabase = await createClient()
  const pos = await nextPosition(supabase, boardId)
  const { data, error } = await supabase
    .from('correlation_members')
    .insert({ correlation_id: boardId, [col]: id, x: pos.x, y: pos.y })
    .select('id, x, y, seq, title, note')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? '添加失败（检查 ID 是否存在）' }

  const [ref] = await resolveReferences(supabase, [{ type, id }])
  return {
    ok: true,
    member: { id: data.id, kind: 'entity', x: data.x, y: data.y, seq: data.seq, title: data.title ?? null, note: data.note ?? null, data: null, ref: ref ?? null },
  }
}

export async function addCardMember(
  boardId: number,
  note: string,
  title?: string,
): Promise<{ ok: true; member: BoardMember } | { ok: false; error: string }> {
  note = note.trim()
  if (!note && !title?.trim()) return { ok: false, error: '卡片不能为空' }
  const supabase = await createClient()
  const pos = await nextPosition(supabase, boardId)
  const { data, error } = await supabase
    .from('correlation_members')
    .insert({ correlation_id: boardId, note: note || (title?.trim() ?? ''), title: title?.trim() || null, x: pos.x, y: pos.y })
    .select('id, x, y, seq, title, note')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? '添加失败' }
  return {
    ok: true,
    member: { id: data.id, kind: 'card', x: data.x, y: data.y, seq: data.seq, title: data.title ?? null, note: data.note ?? null, data: null, ref: null },
  }
}

export async function updateMember(
  id: number,
  fields: { x?: number; y?: number; seq?: number; title?: string | null; note?: string | null; data?: unknown },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (fields.x != null) patch.x = fields.x
  if (fields.y != null) patch.y = fields.y
  if (fields.seq != null) patch.seq = fields.seq
  if (fields.title !== undefined) patch.title = fields.title
  if (fields.note !== undefined) patch.note = fields.note
  if (fields.data !== undefined) patch.data = fields.data
  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await supabase.from('correlation_members').update(patch).eq('id', id)
  return { ok: !error }
}

export async function deleteMember(id: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('correlation_members').delete().eq('id', id)
  return { ok: !error }
}

export async function addEdge(
  boardId: number,
  from: number,
  to: number,
): Promise<{ ok: true; edge: BoardEdge } | { ok: false; error: string }> {
  if (from === to) return { ok: false, error: '不能连到自己' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('correlation_edges')
    .insert({ correlation_id: boardId, from_member: from, to_member: to })
    .select('id, from_member, to_member, label, directed, kind')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? '连线失败' }
  return { ok: true, edge: { id: data.id, from: data.from_member, to: data.to_member, label: data.label ?? null, directed: !!data.directed, kind: data.kind ?? null } }
}

export async function updateEdge(
  id: number,
  fields: { label?: string | null; directed?: boolean; kind?: string | null },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (fields.label !== undefined) patch.label = fields.label
  if (fields.directed !== undefined) patch.directed = fields.directed
  if (fields.kind !== undefined) patch.kind = fields.kind
  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await supabase.from('correlation_edges').update(patch).eq('id', id)
  return { ok: !error }
}

export async function deleteEdge(id: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('correlation_edges').delete().eq('id', id)
  return { ok: !error }
}

// ---- backlinks (AP-13): which boards reference a given piece ----------------

export interface Backlink { board_id: number; title: string }

/**
 * For each anchor ({type,id}), the boards that reference it — keyed by
 * "type/id". Only boards the caller may legitimately discover are surfaced:
 * public + own + shared-with-me. Unlisted-by-others are deliberately excluded
 * (a backlink would otherwise "list" a board whose whole point is being
 * link-only). Batched: one member query per distinct anchor column.
 */
export async function boardBacklinks(
  anchors: { type: string; id: number }[],
): Promise<Record<string, Backlink[]>> {
  if (anchors.length === 0) return {}
  const supabase = await createClient()
  const me = await myUserId(supabase)

  // ids grouped by member column
  const byCol = new Map<string, number[]>()
  for (const a of anchors) {
    const col = TYPE_COL[a.type]
    if (!col) continue
    const arr = byCol.get(col) ?? []
    arr.push(a.id)
    byCol.set(col, arr)
  }
  if (byCol.size === 0) return {}

  // member rows referencing any of the anchors → (anchor col/id → board id)
  type Hit = { correlation_id: number; col: string; anchorId: number }
  const hits: Hit[] = []
  const boardIds = new Set<number>()
  for (const [col, ids] of byCol) {
    const { data } = await supabase
      .from('correlation_members')
      .select(`correlation_id, ${col}`)
      .in(col, ids)
    for (const r of (data ?? []) as unknown as Record<string, number>[]) {
      hits.push({ correlation_id: r.correlation_id, col, anchorId: r[col] })
      boardIds.add(r.correlation_id)
    }
  }
  if (boardIds.size === 0) return {}

  // which of those boards are discoverable by the caller?
  const { data: boards } = await supabase
    .from('correlations')
    .select('id, title, visibility, created_by')
    .in('id', [...boardIds])
  let shareIds = new Set<number>()
  if (me != null) {
    const { data: shares } = await supabase
      .from('correlation_shares').select('correlation_id').eq('user_id', me)
    shareIds = new Set((shares ?? []).map(s => s.correlation_id))
  }
  const visible = new Map<number, string>()
  for (const b of boards ?? []) {
    if (b.visibility === 'public' || (me != null && b.created_by === me) || shareIds.has(b.id)) {
      visible.set(b.id, b.title)
    }
  }

  // assemble result, de-duping boards per anchor
  const out: Record<string, Backlink[]> = {}
  const seen = new Set<string>()
  for (const h of hits) {
    const title = visible.get(h.correlation_id)
    if (title === undefined) continue
    const key = `${COL_TYPE[h.col]}/${h.anchorId}`
    const dedup = `${key}#${h.correlation_id}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    ;(out[key] ??= []).push({ board_id: h.correlation_id, title })
  }
  return out
}

// ---- entity search (find pieces by text instead of looking up ids) ----

const TYPE_TABLE: Record<string, string> = {
  story: 'stories', chapter: 'chapters', node: 'nodes', gadget: 'gadgets',
  event: 'events', option: 'event_options', text: 'text_chunks', furniture: 'furniture_items',
  entity: 'entities',
}
// All relevant text columns searched per type (any-match, not just the name).
const TYPE_SEARCH_COLS: Record<string, string[]> = {
  story: ['name', 'name_en'],
  chapter: ['level_name', 'level_code'],
  node: ['content', 'speaker'],
  gadget: ['name', 'name_en', 'effect', 'description'],
  event: ['name', 'name_en', 'intro'],
  option: ['label', 'description', 'outcome'],
  text: ['title', 'body'],
  furniture: ['name', 'description'],
  entity: ['name', 'name_en', 'summary'],
}

/**
 * Substring search over one entity type's text columns, returning resolved
 * candidates (label/preview/href).
 *
 * - Multi-word queries are tokenised: each whitespace token must match some
 *   column (AND across tokens, OR across columns) — so "顾筌 宁" narrows,
 *   rather than looking for the literal string "顾筌 宁".
 * - `opts.storyId` / `opts.chapterId` scope node/chapter searches, so callers
 *   can find "X within story Y" (a node row can't be matched on its story name
 *   directly — the scope join is the only way to express it).
 */
export async function searchEntities(
  query: string,
  type: string,
  opts?: { storyId?: number; chapterId?: number },
): Promise<ReferenceData[]> {
  const table = TYPE_TABLE[type]
  const cols = TYPE_SEARCH_COLS[type]
  if (!table || !cols) return []

  // Tokenise; strip characters that would break PostgREST's or() grammar.
  const tokens = query.replace(/[(),]/g, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) return []

  const supabase = await createClient()

  // Resolve the scope filter once (node→story goes via the chapter list).
  let scopeStory: number | null = null
  let scopeChapter: number | null = null
  let scopeChapterIds: number[] | null = null
  if (type === 'chapter' && opts?.storyId != null) scopeStory = opts.storyId
  if (type === 'node') {
    if (opts?.chapterId != null) {
      scopeChapter = opts.chapterId
    } else if (opts?.storyId != null) {
      const { data: chs } = await supabase.from('chapters').select('id').eq('story_id', opts.storyId)
      scopeChapterIds = (chs ?? []).map(c => c.id as number)
      if (scopeChapterIds.length === 0) return []
    }
  }

  // Pass 1 — AND across tokens (precise: every token must hit the same row).
  let q1 = supabase.from(table).select('id')
  if (scopeStory != null) q1 = q1.eq('story_id', scopeStory)
  if (scopeChapter != null) q1 = q1.eq('chapter_id', scopeChapter)
  if (scopeChapterIds) q1 = q1.in('chapter_id', scopeChapterIds)
  for (const tok of tokens) q1 = q1.or(cols.map(c => `${c}.ilike.%${tok}%`).join(','))
  const { data: d1 } = await q1.limit(30)
  let ids = (d1 ?? []).map(r => r.id as number)

  // Pass 2 — OR fallback. A natural multi-word query ("W 死去 加入") almost never
  // has every token in one row, so AND dead-ends at 0. Retry matching ANY token
  // and rank by how many distinct tokens the row hits, so the best rows surface.
  if (ids.length === 0 && tokens.length > 1) {
    let q2 = supabase.from(table).select(['id', ...cols].join(', '))
    if (scopeStory != null) q2 = q2.eq('story_id', scopeStory)
    if (scopeChapter != null) q2 = q2.eq('chapter_id', scopeChapter)
    if (scopeChapterIds) q2 = q2.in('chapter_id', scopeChapterIds)
    q2 = q2.or(tokens.flatMap(t => cols.map(c => `${c}.ilike.%${t}%`)).join(','))
    const { data: d2 } = await q2.limit(80)
    const rows = (d2 ?? []) as unknown as Record<string, unknown>[]
    const lowered = tokens.map(t => t.toLowerCase())
    ids = rows
      .map(r => ({
        id: r.id as number,
        hits: lowered.filter(t => cols.some(c => String(r[c] ?? '').toLowerCase().includes(t))).length,
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 30)
      .map(x => x.id)
  }

  if (ids.length === 0) return []
  return resolveReferences(supabase, ids.map(id => ({ type, id })))
}
