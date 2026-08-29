'use client'

import { useState } from 'react'
import { getRelationStatus, extractStoryRelations, type RelationStatus } from '@/app/actions/relations'

export default function RelationsPanel() {
  const [storyId, setStoryId] = useState('')
  const [status, setStatus] = useState<RelationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const id = Number(storyId)
    if (!id) return
    setMsg(null); setStatus(null)
    const s = await getRelationStatus(id)
    if (!s.story) { setMsg('未找到该剧情 id'); return }
    setStatus(s)
  }

  async function extract() {
    if (!status?.story || busy) return
    setBusy(true); setMsg(null)
    const r = await extractStoryRelations(status.story.id)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '抽取失败'); return }
    setMsg(`模型给出 ${r.found} 条，入库 ${r.saved} 条`)
    await load()
  }

  return (
    <section className="border border-ark-border p-4 mt-6 space-y-4 font-mono text-[12px]">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 关系抽取（世界图谱）</p>

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
            <span className="text-ark-muted"> · 可识别角色 {status.character_count}</span>
            <span className="text-ark-muted"> · 已有关系 {status.relation_count}</span>
          </p>
          <button onClick={extract} disabled={busy || status.character_count < 2}
                  className="px-3 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 tracking-widest uppercase transition-colors">
            {busy ? '抽取中…' : '抽取关系'}
          </button>
        </div>
      )}

      {msg && <p className={msg.includes('失败') ? 'text-ark-danger' : 'text-ark-muted'}>{'// ' + msg}</p>}
      <p className="text-[10px] text-ark-muted">只用剧情内简介/摘要作依据，边带 @story 引用；逐条计费。先跑 AP-23 摘要效果更好。</p>
    </section>
  )
}
