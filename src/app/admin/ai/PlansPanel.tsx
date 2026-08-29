'use client'

// Plan-ladder editor (AP-21). Prices themselves live in Stripe; this only maps
// our plan codes onto Stripe Price ids and sets the monthly AI allowance that
// ai_budget_check() enforces. A plan with no price id can't be bought, which
// is how the app ships safely with Stripe unconfigured.

import { useState } from 'react'
import { updatePlan, type AdminPlan } from '@/app/actions/billing'

export default function PlansPanel({ initial, configured }: { initial: AdminPlan[]; configured: boolean }) {
  const [plans, setPlans] = useState<AdminPlan[]>(initial)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function patch(id: number, fields: Partial<AdminPlan>) {
    setPlans(prev => prev.map(p => (p.id === id ? { ...p, ...fields } : p)))
  }

  async function save(p: AdminPlan) {
    setBusy(p.id); setMsg(null)
    const res = await updatePlan(p.id, {
      name: p.name,
      description: p.description,
      monthly_price_usd: p.monthly_price_usd,
      monthly_ai_limit_usd: p.monthly_ai_limit_usd,
      stripe_price_id: p.stripe_price_id,
      is_active: p.is_active,
    })
    setBusy(null)
    setMsg(res.ok ? `已保存 ${p.code}` : (res.error ?? '保存失败'))
  }

  return (
    <section className="border border-ark-border p-4 mt-6 space-y-4 font-mono text-[12px]">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 订阅套餐（AP-21）</p>

      {!configured && (
        <p className="text-ark-border">
          {'//'} Stripe 未配置（STRIPE_SECRET_KEY）——可先编辑额度，付费套餐暂不可购买
        </p>
      )}

      <ul className="space-y-3">
        {plans.map(p => (
          <li key={p.id} className="border border-ark-border/60 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-ark-accent tracking-widest uppercase">{p.code}</span>
              <input
                value={p.name}
                onChange={e => patch(p.id, { name: e.target.value })}
                className="flex-1 bg-ark-surface border border-ark-border px-2 py-1 text-ark-text outline-none focus:border-ark-accent-dim font-sans"
              />
              <label className="flex items-center gap-1 text-ark-muted">
                <input
                  type="checkbox" checked={p.is_active}
                  onChange={e => patch(p.id, { is_active: e.target.checked })}
                  className="accent-[color:var(--ark-accent)]"
                />
                启用
              </label>
            </div>

            <input
              value={p.description ?? ''}
              onChange={e => patch(p.id, { description: e.target.value })}
              placeholder="套餐说明"
              className="w-full bg-ark-surface border border-ark-border px-2 py-1 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
            />

            <div className="flex gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-ark-muted">
                $/月
                <input
                  type="number" step="any" value={p.monthly_price_usd}
                  onChange={e => patch(p.id, { monthly_price_usd: Number(e.target.value) })}
                  className="w-20 bg-ark-surface border border-ark-border px-2 py-1 text-ark-text outline-none focus:border-ark-accent-dim"
                />
              </label>
              <label className="flex items-center gap-1 text-ark-muted">
                AI 额度$
                <input
                  type="number" step="any"
                  value={p.monthly_ai_limit_usd ?? ''}
                  placeholder="空=不限"
                  onChange={e => patch(p.id, {
                    monthly_ai_limit_usd: e.target.value.trim() === '' ? null : Number(e.target.value),
                  })}
                  className="w-24 bg-ark-surface border border-ark-border px-2 py-1 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
                />
              </label>
              <input
                value={p.stripe_price_id ?? ''}
                onChange={e => patch(p.id, { stripe_price_id: e.target.value })}
                placeholder="price_…（Stripe 价格 id）"
                className="flex-1 min-w-44 bg-ark-surface border border-ark-border px-2 py-1 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim"
              />
              <button
                onClick={() => save(p)} disabled={busy === p.id}
                className="px-2.5 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 tracking-widest uppercase transition-colors"
              >
                {busy === p.id ? '保存中' : '保存'}
              </button>
            </div>

            <p className="text-[10px] text-ark-border tracking-widest uppercase">
              {'//'} {p.purchasable ? '可购买' : p.monthly_price_usd === 0 ? '默认（免费）套餐' : '缺少 Stripe 价格 id · 不可购买'}
            </p>
          </li>
        ))}
      </ul>

      {msg && <p className="text-ark-muted">{'// ' + msg}</p>}
    </section>
  )
}
