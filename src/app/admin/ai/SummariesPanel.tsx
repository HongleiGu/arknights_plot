'use client'

import { useState } from 'react'
import {
  getSummaryStatus,
  generateChapterSummary,
  generateStorySummary,
  type SummaryStatus,
} from '@/app/actions/summaries'

export default function SummariesPanel() {
  const [storyId, setStoryId] = useState('')
  const [status, setStatus] = useState<SummaryStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const id = Number(storyId)
    if (!id) return
    setMsg(null); setStatus(null)
    const s = await getSummaryStatus(id)
    if (!s.story) { setMsg('未找到该剧情 id'); return }
    setStatus(s)
  }

  // Drive the loop client-side: one short server action per chapter, so no
  // single request risks the serverless timeout.
  async function generateAll(force: boolean) {
    if (!status?.story || busy) return
    setBusy(true); setMsg(null)
    const todo = status.chapters.filter(c => force || !c.has_summary)
    let done = 0
    for (const c of todo) {
      setProgress(`章节 ${++done}/${todo.length}：${c.label}`)
      const r = await generateChapterSummary(c.id)
      if (!r.ok) { setMsg(`章节 ${c.label} 失败：${r.error}`); setBusy(false); setProgress(null); return }
    }
    setProgress('生成剧情整体梗概…')
    const rs = await generateStorySummary(status.story.id)
    setBusy(false); setProgress(null)
    if (!rs.ok) { setMsg(`剧情梗概失败：${rs.error}`); return }
    setMsg(`完成：${todo.length} 章 + 剧情梗概`)
    await load()
  }

  const doneCount = status?.chapters.filter(c => c.has_summary).length ?? 0

  return (
    <section className="border border-ark-border p-4 mt-6 space-y-4 font-mono text-[12px]">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 内容摘要生成</p>

      <div className="flex gap-2">
        <input
          type="number" value={storyId} onChange={e => setStoryId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
          placeholder="剧情 story id"
          className="w-40 bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
        />
        <button onClick={load} disabled={busy || !storyId.trim()}
                className="px-2.5 border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim disabled:opacity-40 tracking-widest uppercase transition-colors">
          载入
        </button>
      </div>

      {status?.story && (
        <div className="space-y-2">
          <p className="text-ark-text font-sans">
            {status.story.name}
            <span className="text-ark-muted"> · 章节摘要 {doneCount}/{status.chapters.length}</span>
            <span className={status.story_has_summary ? 'text-ark-success' : 'text-ark-muted'}> · 剧情梗概{status.story_has_summary ? '✓' : '×'}</span>
          </p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => generateAll(false)} disabled={busy}
                    className="px-3 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 tracking-widest uppercase transition-colors">
              生成缺失
            </button>
            <button onClick={() => generateAll(true)} disabled={busy}
                    className="px-3 py-1 border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim disabled:opacity-40 tracking-widest uppercase transition-colors">
              全部重算
            </button>
          </div>
          {progress && <p className="text-ark-accent flex items-center gap-2"><Spinner /> {progress}</p>}
        </div>
      )}

      {msg && <p className={msg.includes('失败') ? 'text-ark-danger' : 'text-ark-muted'}>{'// ' + msg}</p>}
      <p className="text-[10px] text-ark-muted">按章生成、逐条计费（计入 AI 预算），大部头可分次运行。</p>
    </section>
  )
}

function Spinner() {
  return <span className="inline-block w-2.5 h-2.5 border border-ark-accent/40 border-t-ark-accent rounded-full animate-spin" />
}
