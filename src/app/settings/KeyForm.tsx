'use client'

import { useState } from 'react'
import { clearAiKey, saveAiKey, type AiKeyStatus } from '@/app/actions/aikey'

const PROVIDERS: [string, string][] = [
  ['openrouter', 'OpenRouter'],
  ['openai', 'OpenAI'],
  ['other', '其它（OpenAI 兼容）'],
]

export default function KeyForm({ initial }: { initial: AiKeyStatus }) {
  const [status, setStatus] = useState(initial)
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState(initial.provider ?? 'openrouter')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (busy || !key.trim()) return
    setBusy(true); setErr(null); setMsg(null)
    const res = await saveAiKey(key, provider)
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    // Drop the plaintext from component state the moment it's stored.
    setKey('')
    setStatus(s => ({ ...s, present: true, provider, hint: res.hint, updated_at: new Date().toISOString() }))
    setMsg('已保存')
  }

  async function clear() {
    if (!confirm('删除已保存的 API Key？之后将回到本站的公共额度。')) return
    setBusy(true); setErr(null); setMsg(null)
    const res = await clearAiKey()
    setBusy(false)
    if (!res.ok) { setErr('删除失败'); return }
    setStatus(s => ({ ...s, present: false, hint: null, updated_at: null }))
    setMsg('已删除')
  }

  if (!status.configured) {
    return (
      <p className="font-mono text-[11px] text-ark-border tracking-widest">
        {'//'} 本站尚未配置密钥存储（缺少 AI_KEY_SECRET），暂时无法保存个人 API Key。
      </p>
    )
  }

  return (
    <div className="space-y-4 font-mono text-[12px]">
      {status.present ? (
        <div className="border border-ark-accent/40 bg-ark-accent/5 p-3">
          <p className="text-ark-accent tracking-widest uppercase">{'//'} 已保存</p>
          <p className="text-ark-text mt-1">
            {PROVIDERS.find(p => p[0] === status.provider)?.[1] ?? status.provider}
            <span className="text-ark-muted"> · sk-…{status.hint}</span>
          </p>
          {status.updated_at && (
            <p className="text-ark-border text-[10px] tracking-widest mt-1">
              {'//'} 更新于 {status.updated_at.slice(0, 10)}
            </p>
          )}
          <button
            onClick={clear} disabled={busy}
            className="mt-2 tracking-widest uppercase text-[10px] text-ark-muted hover:text-ark-danger disabled:opacity-40"
          >
            删除
          </button>
        </div>
      ) : (
        <p className="text-ark-border tracking-widest">{'//'} 尚未保存——当前使用本站公共额度（受每月上限约束）</p>
      )}

      <div className="space-y-2">
        <p className="text-ark-muted tracking-widest uppercase">
          {'//'} {status.present ? '更换' : '填入'} API Key
        </p>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          className="w-full bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text outline-none focus:border-ark-accent-dim"
        >
          {PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-…"
          className="w-full bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text
                     placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
        />
        <button
          onClick={save} disabled={busy || !key.trim()}
          className="px-3 py-1.5 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg
                     disabled:opacity-40 tracking-widest uppercase transition-colors"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>

      {msg && <p className="text-ark-success">{'// ' + msg}</p>}
      {err && <p className="text-ark-danger">{'// ' + err}</p>}
    </div>
  )
}
