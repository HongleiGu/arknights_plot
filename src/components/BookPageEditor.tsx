'use client'

// Admin proofreading panel for one printed page of 大地巡旅 (AP-31).
//
// The whole page is one textarea rather than a field per paragraph. Aligning a
// scan to the printed book needs reordering, splitting, merging and deleting as
// much as fixing characters, and in plain text those are all just editing:
// move a line, press Enter, join two lines, delete a line. A per-paragraph form
// would need a separate control for each, and would still need stable paragraph
// identity across a re-OCR — which doesn't exist.
//
// Saving writes to `book_page_overrides` (040), never to `nodes` directly:
// import_book.py replaces every node of the book on each run, so an edit made
// in `nodes` alone would be silently destroyed by the next import.

import { useState } from 'react'
import {
  getPageDraft, savePageOverride, clearPageOverride, applyPageOverride,
} from '@/app/actions/book'

export default function BookPageEditor({ page }: { page: number }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [overridden, setOverridden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    setBusy(true); setMsg(null)
    const d = await getPageDraft(page)
    setBusy(false)
    if ('error' in d) { setMsg(d.error); return }
    setBody(d.body); setOverridden(d.overridden); setLoaded(true); setOpen(true)
  }

  async function save(andApply: boolean) {
    setBusy(true); setMsg(null)
    const r = await savePageOverride(page, body)
    if (!r.ok) { setBusy(false); setMsg(r.error ?? '保存失败'); return }
    setOverridden(true)
    if (!andApply) { setBusy(false); setMsg('已保存（下次导入时生效）'); return }
    const a = await applyPageOverride(page)
    setBusy(false)
    setMsg(a.ok ? `已保存并应用（${a.count} 段）` : `已保存，但应用失败：${a.error}`)
  }

  async function reset() {
    setBusy(true); setMsg(null)
    const r = await clearPageOverride(page)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '清除失败'); return }
    setOverridden(false); setLoaded(false); setOpen(false)
    setMsg('已清除修订，重新载入以查看导入原文')
  }

  if (!open) {
    return (
      <div className="my-2 font-mono text-[10px]">
        <button onClick={load} disabled={busy}
                className="border border-ark-border px-2 py-1 tracking-widest uppercase
                           text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim
                           disabled:opacity-40 transition-colors">
          {busy ? '载入中…' : `校订第 ${page} 页`}
        </button>
        {msg && <span className="ml-2 text-ark-muted">{'// ' + msg}</span>}
      </div>
    )
  }

  return (
    <div className="my-3 border border-ark-accent-dim bg-ark-surface/30 p-3 space-y-2">
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
        {'//'} 校订 · 第 {page} 页
        {overridden && <span className="text-ark-accent"> · 已有修订</span>}
      </p>
      <p className="text-[10px] text-ark-muted leading-relaxed">
        空行分段；<code className="text-ark-text">{'# '}</code>开头为小标题；
        <code className="text-ark-text">{'[[img:文件名|图注]]'}</code> 为插图。
        段落顺序即阅读顺序，直接调整行序即可。
      </p>
      <textarea
        value={body} onChange={e => setBody(e.target.value)}
        spellCheck={false} rows={18}
        className="w-full bg-ark-bg border border-ark-border px-2 py-1.5 text-sm text-ark-text
                   leading-relaxed outline-none focus:border-ark-accent-dim font-sans"
      />
      <div className="flex gap-2 flex-wrap font-mono text-[10px] tracking-widest uppercase">
        <button onClick={() => save(true)} disabled={busy}
                className="px-3 py-1 border border-ark-accent text-ark-accent
                           hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 transition-colors">
          保存并应用
        </button>
        <button onClick={() => save(false)} disabled={busy}
                className="px-3 py-1 border border-ark-border text-ark-muted
                           hover:text-ark-accent hover:border-ark-accent-dim
                           disabled:opacity-40 transition-colors">
          仅保存
        </button>
        {overridden && (
          <button onClick={reset} disabled={busy}
                  className="px-3 py-1 border border-ark-border text-ark-muted
                             hover:text-ark-danger hover:border-ark-danger/60
                             disabled:opacity-40 transition-colors">
            清除修订
          </button>
        )}
        <button onClick={() => setOpen(false)} disabled={busy}
                className="px-3 py-1 border border-ark-border text-ark-muted
                           hover:text-ark-text disabled:opacity-40 transition-colors">
          收起
        </button>
      </div>
      {msg && <p className="font-mono text-[10px] text-ark-muted">{'// ' + msg}</p>}
      {!loaded && <p className="font-mono text-[10px] text-ark-danger">{'// 未载入'}</p>}
    </div>
  )
}
