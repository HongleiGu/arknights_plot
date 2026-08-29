'use client'

// Plan ladder with the checkout / portal calls (AP-21). The action returns a
// Stripe-hosted URL and we navigate to it — no card details ever touch this app.

import Link from 'next/link'
import { useState } from 'react'
import { openBillingPortal, startCheckout, type BillingStatus, type Plan } from '@/app/actions/billing'

function money(n: number): string {
  return n === 0 ? '免费' : `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`
}

function allowance(usd: number | null): string {
  return usd == null ? '不限额度' : `每月 $${usd.toFixed(2)} AI 额度`
}

export default function PlanCards({
  plans, status, configured, signedIn,
}: {
  plans: Plan[]
  status: BillingStatus | null
  configured: boolean
  signedIn: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function subscribe(code: string) {
    setBusy(code); setError(null)
    const res = await startCheckout(code)
    if (!res.ok) { setError(res.error); setBusy(null); return }
    window.location.assign(res.url)
  }

  async function manage() {
    setBusy('__portal'); setError(null)
    const res = await openBillingPortal()
    if (!res.ok) { setError(res.error); setBusy(null); return }
    window.location.assign(res.url)
  }

  const currentCode = status?.plan_code ?? 'free'
  const subscribed = !!status && status.status !== 'none'

  return (
    <>
      <ul className="grid sm:grid-cols-3 gap-4">
        {plans.map(p => {
          const isCurrent = p.code === currentCode
          return (
            <li
              key={p.id}
              className={`border p-5 flex flex-col ${
                isCurrent ? 'border-ark-accent bg-ark-accent/5' : 'border-ark-border'
              }`}
            >
              <p className="font-mono text-[10px] tracking-widest uppercase text-ark-muted">
                {'//'} {p.code}
              </p>
              <p className="text-lg text-ark-text mt-1">{p.name}</p>
              <p className="text-2xl font-light text-ark-accent mt-2">
                {money(p.monthly_price_usd)}
                {p.monthly_price_usd > 0 && (
                  <span className="font-mono text-[11px] text-ark-muted"> / 月</span>
                )}
              </p>
              <p className="font-mono text-[11px] text-ark-muted mt-2">{'//'} {allowance(p.monthly_ai_limit_usd)}</p>
              {p.description && (
                <p className="text-xs text-ark-muted mt-2 flex-1">{p.description}</p>
              )}
              <div className="mt-4">
                {isCurrent ? (
                  <span className="font-mono text-[10px] tracking-widest uppercase text-ark-success">
                    {'//'} 当前套餐
                  </span>
                ) : !signedIn ? (
                  <Link
                    href="/auth"
                    className="inline-block font-mono text-[10px] tracking-widest uppercase px-3 py-1.5
                               border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors"
                  >
                    登录后订阅
                  </Link>
                ) : p.purchasable ? (
                  <button
                    onClick={() => subscribe(p.code)}
                    disabled={busy != null}
                    className="font-mono text-[10px] tracking-widest uppercase px-3 py-1.5
                               border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg
                               disabled:opacity-40 transition-colors"
                  >
                    {busy === p.code ? '跳转中…' : '订阅'}
                  </button>
                ) : (
                  <span className="font-mono text-[10px] tracking-widest uppercase text-ark-border">
                    {'//'} {p.monthly_price_usd === 0 ? '默认套餐' : '暂未开放'}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {error && <p className="mt-4 font-mono text-[11px] text-ark-danger">{'// '}{error}</p>}

      {subscribed && configured && (
        <button
          onClick={manage}
          disabled={busy != null}
          className="mt-6 font-mono text-[10px] tracking-widest uppercase px-3 py-1.5
                     border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim
                     disabled:opacity-40 transition-colors"
        >
          {busy === '__portal' ? '跳转中…' : '管理订阅 / 账单'}
        </button>
      )}
    </>
  )
}
