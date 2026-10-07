'use client'

// Fill in the chapter descriptions the wiki does not have (AP-37).
//
// A whole story at a time, because that is the unit of work: 主线 has 427
// chapters across 18 arcs and none of them has an official summary, so the
// task is "sit with one arc and write its blurbs", not "find one chapter".
//
// The scraped text, where there is one, is shown greyed above the box — an
// override should be written knowing what it replaces. Saving writes a
// separate `manual` row, so the scrape underneath survives and a later --sync
// can still update it.

import { useEffect, useState } from 'react'
import {
  listStoryDescriptions, saveChapterDescription, clearChapterDescription,
  type ChapterDescription,
} from '@/app/actions/descriptions'

export default function DescriptionEditor({ storyId }: { storyId: number }) {
  const [chapters, setChapters] = useState<ChapterDescription[] | null>(null)
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    const r = await listStoryDescriptions(storyId)
    if ('error' in r) { setMsg(r.error); return }
    setChapters(r.chapters)
    setDraft(Object.fromEntries(r.chapters.map(c => [c.chapterId, c.manual ?? ''])))
  }

  // `.then` with a live flag: setting state synchronously in an effect
  // cascades renders, and the panel can unmount before the load returns.
  useEffect(() => {
    let live = true
    listStoryDescriptions(storyId).then(r => {
      if (!live) return
      if ('error' in r) { setMsg(r.error); return }
      setChapters(r.chapters)
      setDraft(Object.fromEntries(r.chapters.map(c => [c.chapterId, c.manual ?? ''])))
    })
    return () => { live = false }
  }, [storyId])

  async function save(id: number) {
    setBusy(id); setMsg(null)
    const r = await saveChapterDescription(id, draft[id] ?? '')
    setBusy(null)
    setMsg(r.ok ? '已保存' : (r.error ?? '保存失败'))
    if (r.ok) await reload()
  }

  async function clear(id: number) {
    setBusy(id); setMsg(null)
    const r = await clearChapterDescription(id)
    setBusy(null)
    setMsg(r.ok ? '已清除人工描述' : (r.error ?? '清除失败'))
    if (r.ok) await reload()
  }

  if (!chapters) {
    return <p className="font-mono text-xs text-ark-muted tracking-widest">
      {msg ? `// ${msg}` : '// 载入中…'}
    </p>
  }

  const filled = chapters.filter(c => c.body).length

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
        {'//'} {filled}/{chapters.length} 章已有描述
        {chapters.some(c => c.manual) &&
          <span className="text-ark-accent"> · 含人工撰写</span>}
      </p>

      {chapters.map(c => (
        <div key={c.chapterId} className="border-b border-ark-border/40 pb-3">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest">
            <span className="text-ark-border">{String(c.order).padStart(2, '0')}</span>{' '}
            <span className="text-ark-accent">{c.levelCode ?? '—'}</span>{' '}
            {c.levelName}
            {c.source === 'manual' && <span className="text-ark-accent"> · 人工</span>}
            {c.source === 'scraped' && <span className="text-ark-border"> · 官方</span>}
            {!c.source && <span className="text-ark-danger"> · 无描述</span>}
          </p>

          {c.scraped && (
            <p className="text-[11px] text-ark-border leading-relaxed my-1">
              官方：{c.scraped}
            </p>
          )}

          <textarea
            value={draft[c.chapterId] ?? ''}
            onChange={e => setDraft({ ...draft, [c.chapterId]: e.target.value })}
            rows={2} spellCheck={false}
            placeholder={c.scraped ? '留空则沿用官方描述' : '写一句话概括这一章'}
            className="w-full bg-ark-bg border border-ark-border px-2 py-1 text-sm
                       text-ark-text leading-relaxed outline-none
                       focus:border-ark-accent-dim font-sans"
          />
          <div className="flex gap-2 font-mono text-[10px] tracking-widest uppercase mt-1">
            <button disabled={busy === c.chapterId} onClick={() => void save(c.chapterId)}
                    className="px-2 py-0.5 border border-ark-accent text-ark-accent
                               hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40">
              保存
            </button>
            {c.manual && (
              <button disabled={busy === c.chapterId} onClick={() => void clear(c.chapterId)}
                      className="px-2 py-0.5 border border-ark-border text-ark-muted
                                 hover:text-ark-danger hover:border-ark-danger/60
                                 disabled:opacity-40">
                清除
              </button>
            )}
          </div>
        </div>
      ))}

      {msg && <p className="font-mono text-[10px] text-ark-muted">{'// ' + msg}</p>}
    </div>
  )
}
