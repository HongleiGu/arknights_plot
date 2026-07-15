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

export interface BoardSummary {
  id: number
  title: string
  description: string | null
  layout: string
  is_owner: boolean
  member_count: number
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
}

export interface Board {
  id: number
  title: string
  description: string | null
  layout: string
  is_owner: boolean
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

export async function listBoards(): Promise<BoardSummary[]> {
  const supabase = await createClient()
  const me = await myUserId(supabase)
  const { data: boards } = await supabase
    .from('correlations')
    .select('id, title, description, layout, created_by')
    .order('created_at', { ascending: false })
  if (!boards || boards.length === 0) return []

  const ids = boards.map(b => b.id)
  const { data: members } = await supabase
    .from('correlation_members').select('correlation_id').in('correlation_id', ids)
  const counts = new Map<number, number>()
  for (const m of members ?? []) counts.set(m.correlation_id, (counts.get(m.correlation_id) ?? 0) + 1)

  return boards.map(b => ({
    id: b.id,
    title: b.title,
    description: b.description ?? null,
    layout: b.layout ?? 'board',
    is_owner: me != null && b.created_by === me,
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
  const { data, error } = await supabase
    .from('correlations')
    .insert({ title, description: description?.trim() || null, created_by: me })
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
    .select('id, title, description, layout, created_by')
    .eq('id', id)
    .maybeSingle()
  if (!board) return null

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
    .select('id, from_member, to_member, label, directed')
    .eq('correlation_id', id)
  const edges: BoardEdge[] = (edgeRows ?? []).map(e => ({
    id: e.id, from: e.from_member, to: e.to_member, label: e.label ?? null, directed: !!e.directed,
  }))

  return {
    id: board.id,
    title: board.title,
    description: board.description ?? null,
    layout: board.layout ?? 'board',
    is_owner: me != null && board.created_by === me,
    members,
    edges,
  }
}

export async function updateBoard(
  id: number,
  fields: { title?: string; description?: string; layout?: string },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (fields.title != null) patch.title = fields.title.trim()
  if (fields.description != null) patch.description = fields.description.trim() || null
  if (fields.layout != null) patch.layout = fields.layout
  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await supabase.from('correlations').update(patch).eq('id', id)
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
    .select('id, from_member, to_member, label, directed')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? '连线失败' }
  return { ok: true, edge: { id: data.id, from: data.from_member, to: data.to_member, label: data.label ?? null, directed: !!data.directed } }
}

export async function updateEdge(
  id: number,
  fields: { label?: string | null; directed?: boolean },
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (fields.label !== undefined) patch.label = fields.label
  if (fields.directed !== undefined) patch.directed = fields.directed
  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await supabase.from('correlation_edges').update(patch).eq('id', id)
  return { ok: !error }
}

export async function deleteEdge(id: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('correlation_edges').delete().eq('id', id)
  return { ok: !error }
}

// ---- entity search (find pieces by text instead of looking up ids) ----

const TYPE_TABLE: Record<string, string> = {
  story: 'stories', chapter: 'chapters', node: 'nodes', gadget: 'gadgets',
  event: 'events', option: 'event_options', text: 'text_chunks', furniture: 'furniture_items',
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
}

/**
 * Search one entity type by a text fragment across all its relevant text
 * columns (name/title/content/…), returning resolved candidates
 * (label/preview/href). Capped at 20. node/text scans can be heavier — that's
 * why the type is explicit rather than searching everything at once.
 */
export async function searchEntities(query: string, type: string): Promise<ReferenceData[]> {
  // Strip characters that would break PostgREST's `or()` grammar.
  query = query.trim().replace(/[(),]/g, ' ').trim()
  if (!query) return []
  const table = TYPE_TABLE[type]
  const cols = TYPE_SEARCH_COLS[type]
  if (!table || !cols) return []

  const supabase = await createClient()
  const orFilter = cols.map(c => `${c}.ilike.%${query}%`).join(',')
  const { data } = await supabase
    .from(table)
    .select('id')
    .or(orFilter)
    .limit(20)
  const ids = (data ?? []).map(r => r.id as number)
  if (ids.length === 0) return []
  return resolveReferences(supabase, ids.map(id => ({ type, id })))
}
