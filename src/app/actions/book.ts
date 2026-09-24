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
  /**
   * True when what the reader sees matches this text. False means a saved draft
   * has not been applied to `nodes` — which nothing will do on its own, since
   * the import that used to pick it up is no longer allowed to run.
   */
  applied: boolean
}

interface NodeRow {
  seq: number
  type: string
  content: string | null
  raw_params: {
    page?: number; image?: string; images?: string[]
    caption?: string; captions?: (string | null)[]
    heading?: boolean; level?: number; aside?: boolean; aside_start?: boolean
    quote?: boolean
  } | null
}

/**
 * Serialise a page's imported nodes into the editable text form.
 *
 * Blocks are separated by a blank line. Inside an inserted block, paragraphs
 * are separated by a marker-only `>>` line instead — a blank line there ends
 * the block, which is how the author says "two blocks" rather than "two
 * paragraphs of one block". Mirrors page_to_text in import_book.py.
 */
function toText(nodes: NodeRow[]): string {
  const out: string[] = []
  let prevAside = false
  for (const n of nodes) {
    const rp = n.raw_params ?? {}
    const imgs = rp.images?.length ? rp.images : (rp.image ? [rp.image] : [])
    const aside = !!rp.aside
    let piece: string
    if (n.type === 'cgitem' && imgs.length) {
      // Files comma-separated; captions pipe-separated after them. One caption
      // applies to the whole row, N caption the N images individually.
      const caps = rp.captions?.length ? rp.captions
                 : (rp.caption ? [rp.caption] : [])
      const tail = caps.length ? caps.map(c => `|${c ?? ''}`).join('') : ''
      // Only the first line carries the marker — a caption may span paragraphs
      // and the token is parsed back whole, before markers are stripped.
      piece = `${aside ? '>> ' : ''}[[img:${imgs.join(',')}${tail}]]`
    } else if (n.content) {
      const lvl = rp.level ?? (rp.heading ? 1 : 0)
      piece = (lvl ? '#'.repeat(Math.min(lvl, 5)) + ' ' : '') + n.content
      // Markers nest outwards: the quote mark sits inside the aside mark, so a
      // quoted line in an inserted block reads `>> " …`.
      if (rp.quote) piece = piece.split('\n').map(x => `" ${x}`).join('\n')
      if (aside) piece = piece.split('\n').map(x => `>> ${x}`).join('\n')
    } else {
      continue
    }
    // A row not flagged as starting a block continues the one above it. Rows
    // written before the flag existed carry none, which reads as "continues" —
    // the single block they rendered as back then.
    if (aside && prevAside && !rp.aside_start) out[out.length - 1] += '\n>>\n' + piece
    else out.push(piece)
    prevAside = aside
  }
  return out.join('\n\n')
}

/**
 * The current text of one printed page, as edited if an override exists and as
 * imported otherwise — so opening a page for the first time shows exactly what
 * the reader shows, and saving it unchanged is a no-op rather than a rewrite.
 */
export async function getPageDraft(page: number): Promise<PageDraft | { error: string }> {
  if (!(await isCurrentUserAdmin())) return { error: '无权限（仅管理员）' }
  const db = await createClient()

  // `raw_params->>page` is the printed page; nodes are ordered by seq within a
  // chapter, and a page never spans two chapters, so seq is the page's order.
  const { data: nodes } = await db.from('nodes')
    .select('seq, type, content, raw_params')
    .eq('raw_params->>page', String(page))
    .order('seq')
  const rows = (nodes ?? []) as unknown as NodeRow[]
  const live = rows.length ? toText(rows) : null

  const { data: ov } = await db.from('book_page_overrides')
    .select('body, note').eq('page', page).maybeSingle()
  if (ov) {
    // A saved override that does not match the nodes is a draft nobody is
    // reading. That used to be fine — "takes effect at the next import" — but
    // the import is no longer allowed to run, so an unapplied draft is now a
    // silent divergence between this editor and the page, and has to be said.
    return { page, body: ov.body, overridden: true, note: ov.note,
             applied: live !== null && ov.body.trim() === live.trim() }
  }
  if (live === null) return { error: `第 ${page} 页没有已导入的内容` }
  return { page, body: live, overridden: false, note: null, applied: true }
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

  // A page may now hold MORE paragraphs than it was imported with. It has to:
  // splitting a paragraph the OCR ran together is the commonest correction
  // there is, and this used to refuse and tell you to re-run import_book.py —
  // which now refuses in turn, because the database is the authority. So the
  // rest of the chapter is shifted down to make room.
  //
  // Safe because `(chapter_id, seq)` is a plain index, not a unique constraint
  // (002), so the shift cannot collide mid-flight. Shrinking deliberately does
  // NOT shift back: leaving a gap in seq costs nothing — seq is only an
  // ordering — while rewriting the tail twice per edit would not be.
  const grow = blocks.length - rows.length
  if (grow > 0) {
    const hi = seqs[seqs.length - 1]
    const tail: { id: number; seq: number }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('nodes')
        .select('*').eq('chapter_id', chapterId).gt('seq', hi)
        .order('seq').range(from, from + 999)
      if (error) return { ok: false, error: error.message }
      tail.push(...(data ?? []) as { id: number; seq: number }[])
      if ((data ?? []).length < 1000) break
    }
    if (tail.length) {
      // Whole rows, because an upsert still evaluates its INSERT tuple and the
      // table has NOT NULL columns — sending only {id, seq} would be rejected
      // before the conflict clause ever ran.
      const { error } = await db.from('nodes')
        .upsert(tail.map(n => ({ ...n, seq: n.seq + grow })), { onConflict: 'id' })
      if (error) return { ok: false, error: `无法为新增段落腾出位置：${error.message}` }
    }
  }

  // Verify the delete actually removed the old nodes before inserting the new
  // ones. Under RLS a delete the policy disallows affects zero rows WITHOUT
  // erroring, so a policy gap would leave both versions of the page in place
  // rather than failing — which reads as duplicated text, not as a permission
  // problem. `select()` makes postgrest return the deleted rows so this is
  // checkable at all.
  const { data: removed, error: delErr } = await db.from('nodes')
    .delete().in('id', rows.map(r => r.id)).select('id')
  if (delErr) return { ok: false, error: delErr.message }
  if ((removed ?? []).length !== rows.length) {
    return { ok: false,
             error: `无法替换该页节点（删除 ${(removed ?? []).length}/${rows.length}）；` +
                    `请确认迁移 041 已应用` }
  }
  const insert = await Promise.all(blocks.map(async (b, i) => {
    const imgs = b.images ?? []
    const caps = b.captions ?? []
    const sha1s = await Promise.all(imgs.map(f => sha1(`book-images/${f}`)))
    return {
      chapter_id: chapterId,
      // Count up from the page's first slot rather than reusing seqs[i], which
      // is undefined past the original paragraph count. The tail was shifted by
      // `grow` above, so lo … lo+blocks.length-1 is free either way.
      seq: seqs[0] + i,
      type: imgs.length ? 'cgitem' : 'subtitle',
      speaker: imgs.length ? null : 'narrator',
      content: imgs.length ? null : b.text,
      raw_params: imgs.length
        ? { page, source: 'override', kind: 'image',
            image: imgs[0], image_sha1: sha1s[0],
            ...(imgs.length > 1 ? { images: imgs, image_sha1s: sha1s } : {}),
            ...(caps.length === 1 && caps[0] ? { caption: caps[0] } : {}),
            ...(caps.length > 1 ? { captions: caps } : {}),
            // Part of an inserted block: the reader indents it under the same
            // rule as the block's prose rather than running it full-width.
            ...(b.aside ? { aside: true } : {}),
            ...(b.aside_start ? { aside_start: true } : {}) }
        : { page, source: 'override',
            ...(b.heading ? { heading: true, level: b.level ?? 1 } : {}),
            ...(b.aside ? { aside: true } : {}),
            // First chunk of its block. Without it two blocks that happen to
            // be adjacent render as one.
            ...(b.aside_start ? { aside_start: true } : {}),
            ...(b.quote ? { quote: true } : {}) },
    }
  }))
  const { error } = await db.from('nodes').insert(insert)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/大地巡旅', 'layout')
  return { ok: true, count: blocks.length }
}

// --- format helpers, mirroring import_book.py -------------------------------

// [\s\S] for the caption tail, not `.`: 10 of the book's captions contain a
// line break, and with `.` the token failed to match and the illustration was
// silently rewritten as a paragraph of literal markup.
const IMG_LINE = /^\[\[img:([^|\]]+?)\s*(?:\|([\s\S]*))?\]\]$/
// Tokens are lifted out before blank-line splitting so a caption can run to
// several paragraphs; non-greedy so two adjacent tokens don't merge.
const IMG_TOKEN = /\[\[img:[\s\S]*?\]\]/g

interface Block {
  text?: string; images?: string[]; captions?: (string | null)[]
  heading?: boolean; level?: number; aside?: boolean; aside_start?: boolean
  quote?: boolean
}

// `>> ` marks an inserted block. NOT a single `>`: 11 of the book's paragraphs
// begin with `> ` as printed content (PRTS terminal prompts), which a
// single-`>` marker would strip on the first save. Mirrors ASIDE_LINE in
// import_book.py.
const ASIDE_LINE = /^>>[ \t]?/gm
// `" ` marks a quoted passage — a document reproduced in the text rather than
// described by it (p185's case file, a letter, a transcript). A single `"`
// because it collides with nothing: 0 of the book's 3,925 non-empty lines start
// with it, Chinese print using “ ” and 「 」 instead. Mirrors QUOTE_LINE in
// import_book.py. Stripped per line so a multi-line quotation inside one
// paragraph does not keep its markers as text.
const QUOTE_LINE = /^"[ \t]?/gm
// How an image token survives the blank-line split: it is masked to a
// newline-free placeholder, the body is split, and the token is swapped back.
// The first cut LIFTED tokens out instead, which protected a caption running to
// several paragraphs but threw away the token's POSITION — and position is what
// says whether a plate continues the block above it or starts a new one.
// Mirrors PLACEHOLDER in import_book.py.
const PLACEHOLDER_RE = /\x00img(\d+)\x00/g

// `#` … `#####`. Five levels because MinerU resolves only two and the print
// nests deeper; the extra depth is assigned by hand while proofreading.
const HEAD_LINE = /^(#{1,5})\s+([\s\S]*)$/

function body(text: string): Block[] {
  // A blank line separates blocks, and that is also what separates two inserted
  // blocks: `>> a` / blank / `>> b` is two blocks, while `>> a` / `>>` / `>> b`
  // is one block of two paragraphs. The boundary therefore has to be decided
  // before anything is pulled out of the text. Mirrors text_to_page in
  // import_book.py — these two must stay in step.
  const toks: string[] = []
  const masked = text.replace(IMG_TOKEN, t => `\x00img${toks.push(t) - 1}\x00`)
  const out: Block[] = []

  const flags = (aside: boolean, start: boolean) =>
    aside ? { aside: true, ...(start ? { aside_start: true } : {}) } : {}

  const pushText = (t: string, aside: boolean, start: boolean) => {
    // Quote before heading, and exclusive with it: a quoted passage is
    // reproduced verbatim, so a `#` inside one is part of what was quoted.
    if (/^"/.test(t)) {
      out.push({ text: t.replace(QUOTE_LINE, '').trim(), quote: true, ...flags(aside, start) })
      return
    }
    const h = HEAD_LINE.exec(t)
    if (h) out.push({ text: h[2].trim(), heading: true, level: h[1].length, ...flags(aside, start) })
    else out.push({ text: t, ...flags(aside, start) })
  }

  const pushImage = (tok: string, aside: boolean, start: boolean) => {
    const m = IMG_LINE.exec(tok.trim())
    if (!m) return
    out.push({
      images: m[1].split(',').map(f => f.trim()).filter(Boolean),
      captions: m[2] === undefined ? []
              : m[2].split('|').map(c => c.trim() || null),
      ...flags(aside, start),
    })
  }

  /** One paragraph, which may interleave text and plates. Returns `start`. */
  const pushPara = (part: string, aside: boolean, start: boolean): boolean => {
    let pos = 0
    for (const m of part.matchAll(PLACEHOLDER_RE)) {
      const lead = part.slice(pos, m.index).trim()
      if (lead) { pushText(lead, aside, start); start = false }
      pushImage(toks[Number(m[1])], aside, start)
      start = false
      pos = m.index + m[0].length
    }
    const tail = part.slice(pos).trim()
    if (tail) { pushText(tail, aside, start); start = false }
    return start
  }

  for (const block of masked.split(/\n\s*\n/)) {
    const b = block.trim()
    if (!b) continue
    if (/^>>/.test(b)) {
      // A blank line ended whatever came before, so this is a new block. Inside
      // it, strip the marker from every line and split on the remainder's own
      // blank lines — a `>>` line with nothing after it is blank INSIDE the
      // block but not blank to the outer splitter, which is precisely what lets
      // one block hold several paragraphs.
      let start = true
      for (const sub of b.replace(ASIDE_LINE, '').split(/\n\s*\n/)) {
        const t = sub.trim()
        if (t) start = pushPara(t, true, start)
      }
    } else {
      pushPara(b, false, false)
    }
  }
  return out
}

/** sha1 of the data/-relative path — the asset key convention (storage.ts). */
async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
