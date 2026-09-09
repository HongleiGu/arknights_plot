'use server'

// Proofreading surface for 大地巡旅 (AP-31, migration 040).
//
// A page is edited as ONE plain-text field rather than per-paragraph, because
// aligning a scan to the printed book needs reordering, splitting, merging and
// deleting — not just fixing words. In text form all four are the same edit:
// move a line, press Enter, join two lines, delete a line.
//
// The result is written to `book_page_overrides`, NOT to `nodes`.
// `import_book.py` deletes and re-inserts every chapter of the book on each
// run, so an edited node is destroyed by the next import with no warning. The
// override table is the one thing the import reads rather than replaces.
//
// Format (kept identical to page_to_text/text_to_page in import_book.py):
//   blocks separated by a blank line, `# ` marks a heading,
//   `[[img:file|caption]]` pins an illustration in the flow.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'

export interface PageDraft {
  page: number
  body: string
  /** True when the text came from a saved override rather than the import. */
  overridden: boolean
  note: string | null
}

interface NodeRow {
  seq: number
  type: string
  content: string | null
  raw_params: { page?: number; image?: string; caption?: string; heading?: boolean } | null
}

/** Serialise a page's imported nodes into the editable text form. */
function toText(nodes: NodeRow[]): string {
  return nodes.map(n => {
    const rp = n.raw_params ?? {}
    if (n.type === 'cgitem' && rp.image) {
      return `[[img:${rp.image}${rp.caption ? `|${rp.caption}` : ''}]]`
    }
    return (rp.heading ? '# ' : '') + (n.content ?? '')
  }).filter(Boolean).join('\n\n')
}

/**
 * The current text of one printed page, as edited if an override exists and as
 * imported otherwise — so opening a page for the first time shows exactly what
 * the reader shows, and saving it unchanged is a no-op rather than a rewrite.
 */
export async function getPageDraft(page: number): Promise<PageDraft | { error: string }> {
  if (!(await isCurrentUserAdmin())) return { error: '无权限（仅管理员）' }
  const db = await createClient()

  const { data: ov } = await db.from('book_page_overrides')
    .select('body, note').eq('page', page).maybeSingle()
  if (ov) return { page, body: ov.body, overridden: true, note: ov.note }

  // `raw_params->>page` is the printed page; nodes are ordered by seq within a
  // chapter, and a page never spans two chapters, so seq is the page's order.
  const { data: nodes } = await db.from('nodes')
    .select('seq, type, content, raw_params')
    .eq('raw_params->>page', String(page))
    .order('seq')
  const rows = (nodes ?? []) as unknown as NodeRow[]
  if (rows.length === 0) return { error: `第 ${page} 页没有已导入的内容` }
  return { page, body: toText(rows), overridden: false, note: null }
}

export async function savePageOverride(
  page: number, body: string, note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: '无权限（仅管理员）' }
  if (!body.trim()) return { ok: false, error: '内容为空' }

  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  const { data: me } = user
    ? await db.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
    : { data: null }

  const { error } = await db.from('book_page_overrides').upsert({
    page,
    body: body.trim(),
    // Deliberately not set here: source_hash is the fingerprint of the
    // IMPORTER's text for this page, and only import_book.py can compute it
    // against book_sections.json. Leaving it null means "never compared",
    // which is honest; a wrong hash would suppress the staleness warning.
    note: note?.trim() || null,
    updated_by: me?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'page' })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/大地巡旅', 'layout')
  return { ok: true }
}

/** Drop an override so the page falls back to the imported text. */
export async function clearPageOverride(page: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: '无权限（仅管理员）' }
  const db = await createClient()
  const { error } = await db.from('book_page_overrides').delete().eq('page', page)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/大地巡旅', 'layout')
  return { ok: true }
}

/**
 * Apply a saved override to the live `nodes` rows for that page.
 *
 * Without this, an edit only becomes visible after re-running import_book.py
 * from a terminal, which makes proofreading unusable as a UI. The override
 * table remains the source of truth — this just keeps the reader in step, and
 * the next import reproduces exactly the same result from the same rows.
 */
export async function applyPageOverride(page: number): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: '无权限（仅管理员）' }
  const db = await createClient()

  const { data: ov } = await db.from('book_page_overrides')
    .select('body').eq('page', page).maybeSingle()
  if (!ov) return { ok: false, error: '该页没有保存的修订' }

  const { data: existing } = await db.from('nodes')
    .select('id, seq, chapter_id')
    .eq('raw_params->>page', String(page))
    .order('seq')
  const rows = (existing ?? []) as { id: number; seq: number; chapter_id: number }[]
  if (rows.length === 0) return { ok: false, error: '该页没有已导入的节点' }

  // Reuse the existing seq range so surrounding pages keep their order, and so
  // the page's nodes stay contiguous within the chapter.
  const chapterId = rows[0].chapter_id
  const seqs = rows.map(r => r.seq).sort((a, b) => a - b)
  const blocks = body(ov.body)
  if (blocks.length > seqs.length) {
    return { ok: false, error: `修订后有 ${blocks.length} 段，多于原有的 ${seqs.length} 段；` +
                               `请重新运行 import_book.py 以重建该章节` }
  }

  await db.from('nodes').delete().in('id', rows.map(r => r.id))
  const insert = await Promise.all(blocks.map(async (b, i) => ({
    chapter_id: chapterId,
    seq: seqs[i],
    type: b.image ? 'cgitem' : 'subtitle',
    speaker: b.image ? null : 'narrator',
    content: b.image ? null : b.text,
    raw_params: b.image
      ? { page, source: 'override', image: b.image, kind: 'image',
          ...(b.caption ? { caption: b.caption } : {}),
          image_sha1: await sha1(`book-images/${b.image}`) }
      : { page, source: 'override', ...(b.heading ? { heading: true } : {}) },
  })))
  const { error } = await db.from('nodes').insert(insert)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/大地巡旅', 'layout')
  return { ok: true, count: blocks.length }
}

// --- format helpers, mirroring import_book.py -------------------------------

const IMG_LINE = /^\[\[img:([^|\]]+)(?:\|(.*))?\]\]$/

interface Block { text?: string; image?: string; caption?: string; heading?: boolean }

function body(text: string): Block[] {
  return text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    const m = IMG_LINE.exec(b)
    if (m) return { image: m[1].trim(), caption: (m[2] ?? '').trim() || undefined }
    if (b.startsWith('# ')) return { text: b.slice(2).trim(), heading: true }
    return { text: b }
  })
}

/** sha1 of the data/-relative path — the asset key convention (storage.ts). */
async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
