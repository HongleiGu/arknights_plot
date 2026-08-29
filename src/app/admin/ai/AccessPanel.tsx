'use client'

import { useState } from 'react'
import { setUserAiAccess, type AiAccessEntry } from '@/app/actions/budget'

export default function AccessPanel({ initial }: { initial: AiAccessEntry[] }) {
  const [rows, setRows] = useState<AiAccessEntry[]>(initial)
  const [email, setEmail] = useState('')
  const [access, setAccess] = useState<'allow' | 'block' | ''>('allow')
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function upsertRow(e: AiAccessEntry) {
    setRows(prev => {
      const rest = prev.filter(r => r.user_id !== e.user_id)
      // drop entirely when cleared to no access + no override
      return e.ai_access == null && e.ai_limit_usd == null ? rest : [...rest, e]
    })
  }

  async function apply(targetEmail: string, acc: 'allow' | 'block' | null, lim: number | null) {
    setBusy(true); setMsg(null)
    const res = await setUserAiAccess(targetEmail, acc, lim)
    setBusy(false)
    if (!res.ok) { setMsg(res.error); return }
    upsertRow({ user_id: res.user_id, display_name: res.display_name, ai_access: acc, ai_limit_usd: lim })
    return true
  }

  async function add() {
    const e = email.trim()
    if (!e || busy) return
    const ok = await apply(e, access === '' ? null : access, limit.trim() === '' ? null : Number(limit))
    if (ok) { setEmail(''); setLimit('') }
  }

  return (
    <section className="border border-ark-border p-4 mt-6 space-y-4 font-mono text-[12px]">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 用户级授权 / 封禁</p>

      {/* add by email */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="someone@example.com"
          className="flex-1 min-w-40 bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
        />
        <select value={access} onChange={e => setAccess(e.target.value as 'allow' | 'block' | '')}
                className="bg-ark-surface border border-ark-border px-1.5 text-ark-text outline-none focus:border-ark-accent-dim">
          <option value="allow">授权</option>
          <option value="block">封禁</option>
          <option value="">跟随全局</option>
        </select>
        <input
          type="number" step="any" value={limit} onChange={e => setLimit(e.target.value)}
          placeholder="月上限$（可选）"
          className="w-32 bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
        />
        <button onClick={add} disabled={busy || !email.trim()}
                className="px-2.5 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 tracking-widest uppercase transition-colors">
          应用
        </button>
      </div>
      {msg && <p className="text-ark-danger">{'// ' + msg}</p>}

      {/* current entries */}
      {rows.length === 0 ? (
        <p className="text-ark-border">{'// 暂无用户级设置（跟随全局模式）'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.sort((a, b) => a.user_id - b.user_id).map(r => (
            <li key={r.user_id} className="flex items-center gap-2">
              <span className="flex-1 font-sans text-ark-text truncate">{r.display_name || `用户 #${r.user_id}`}</span>
              {r.ai_access && (
                <span className={r.ai_access === 'block' ? 'text-ark-danger' : 'text-ark-success'}>
                  {r.ai_access === 'block' ? '封禁' : '授权'}
                </span>
              )}
              {r.ai_limit_usd != null && <span className="text-ark-muted">${r.ai_limit_usd}/月</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
