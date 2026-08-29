'use client'

import { useState } from 'react'
import { updateBudgetConfig, type AccessMode, type BudgetConfig } from '@/app/actions/budget'

// Empty string ↔ NULL (unlimited); a number ↔ a cap.
function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const ACCESS_OPTS: { value: AccessMode; label: string; hint: string }[] = [
  { value: 'admin',      label: '仅管理员',   hint: '只有管理员可用（默认）' },
  { value: 'allowlist',  label: '白名单',     hint: '管理员+被授权的用户可用' },
  { value: 'subscriber', label: '付费订阅者', hint: '管理员+被授权用户+持有生效付费订阅的用户（AP-21）' },
  { value: 'all',        label: '所有登录用户', hint: '任何登录用户都可用（靠预算/封禁控制）' },
]

export default function BudgetForm({ config }: { config: BudgetConfig }) {
  const [mode, setMode] = useState<'openrouter' | 'custom'>(config.pricing_mode)
  const [access, setAccess] = useState<AccessMode>(config.access_mode)
  const [inP, setInP] = useState(String(config.input_price_per_m))
  const [outP, setOutP] = useState(String(config.output_price_per_m))
  const [monthly, setMonthly] = useState(config.monthly_limit_usd?.toString() ?? '')
  const [perUser, setPerUser] = useState(config.per_user_limit_usd?.toString() ?? '')
  const [maxSteps, setMaxSteps] = useState(String(config.max_steps))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const res = await updateBudgetConfig({
      pricing_mode: mode,
      access_mode: access,
      input_price_per_m: Number(inP) || 0,
      output_price_per_m: Number(outP) || 0,
      monthly_limit_usd: numOrNull(monthly),
      per_user_limit_usd: numOrNull(perUser),
      max_steps: Number(maxSteps) || 8,
    })
    setBusy(false)
    setMsg(res.ok ? '已保存' : (res.error ?? '保存失败'))
  }

  return (
    <section className="border border-ark-border p-4 space-y-4">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 配置</p>

      {/* access mode */}
      <div>
        <p className="text-[10px] text-ark-muted mb-1.5">谁可以使用 AI</p>
        <div className="flex gap-2 flex-wrap">
          {ACCESS_OPTS.map(o => (
            <button
              key={o.value} onClick={() => setAccess(o.value)}
              className={`px-3 py-1 border tracking-widest uppercase transition-colors ${
                access === o.value ? 'border-ark-accent text-ark-accent bg-ark-accent/10' : 'border-ark-border text-ark-muted hover:text-ark-text'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ark-muted mt-1.5">{ACCESS_OPTS.find(o => o.value === access)?.hint}</p>
      </div>

      {/* pricing mode */}
      <div>
        <p className="text-[10px] text-ark-muted mb-1.5">计价来源（预算按此列统计）</p>
        <div className="flex gap-2">
          {(['openrouter', 'custom'] as const).map(m => (
            <button
              key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 border tracking-widest uppercase transition-colors ${
                mode === m ? 'border-ark-accent text-ark-accent bg-ark-accent/10' : 'border-ark-border text-ark-muted hover:text-ark-text'
              }`}
            >
              {m === 'openrouter' ? 'OpenRouter 实际' : '自定义'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ark-muted mt-1.5">
          {mode === 'openrouter' ? 'OpenRouter 返回的真实计费。' : '按下方单价×tokens 计算（订阅/转售用）。'}
        </p>
      </div>

      {/* custom prices */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="输入 $/1M tokens" value={inP} onChange={setInP} disabled={mode !== 'custom'} />
        <Field label="输出 $/1M tokens" value={outP} onChange={setOutP} disabled={mode !== 'custom'} />
      </div>

      {/* limits */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="月度总上限 $（空=无限）" value={monthly} onChange={setMonthly} placeholder="无限" />
        <Field label="每用户月上限 $（空=无限）" value={perUser} onChange={setPerUser} placeholder="无限" />
      </div>

      {/* agent loop depth */}
      <div>
        <p className="text-[10px] text-ark-muted mb-1.5">单次回答最大检索步数</p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-ark-muted hover:text-ark-text">
            <input
              type="checkbox" checked={maxSteps === '0'}
              onChange={e => setMaxSteps(e.target.checked ? '0' : '8')}
              className="accent-ark-accent"
            />
            无限制
          </label>
          <input
            type="number" min={1} max={24} value={maxSteps === '0' ? '' : maxSteps}
            disabled={maxSteps === '0'}
            onChange={e => setMaxSteps(e.target.value)}
            placeholder="1-24"
            className="w-24 bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text
                       outline-none focus:border-ark-accent-dim disabled:opacity-40"
          />
        </div>
        <p className="text-[10px] text-ark-muted mt-1.5">
          复杂多跳问题需要更多步数；步数越高单次花费越高。默认 8。「无限制」仍受硬上限 60 步与预算约束。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={busy}
          className="px-3 py-1.5 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 tracking-widest uppercase transition-colors"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        {msg && <span className="text-[11px] text-ark-muted">{msg}</span>}
      </div>
    </section>
  )
}

function Field({
  label, value, onChange, disabled, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-[10px] text-ark-muted mb-1">{label}</span>
      <input
        type="number" step="any" value={value} disabled={disabled} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text outline-none focus:border-ark-accent-dim disabled:opacity-40"
      />
    </label>
  )
}
