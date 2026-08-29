import { redirect } from 'next/navigation'
import { getBudgetOverview, listAiAccess } from '@/app/actions/budget'
import BudgetForm from './BudgetForm'
import AccessPanel from './AccessPanel'
import SummariesPanel from './SummariesPanel'
import RelationsPanel from './RelationsPanel'
import PlansPanel from './PlansPanel'
import { billingConfigured, listPlansAdmin } from '@/app/actions/billing'

export const dynamic = 'force-dynamic'

function usd(n: number): string {
  return '$' + n.toFixed(n < 1 ? 4 : 2)
}

export default async function AiBudgetPage() {
  const o = await getBudgetOverview()
  if (!o) redirect('/') // non-admin
  const access = await listAiAccess()
  const plans = await listPlansAdmin()
  const stripeOn = await billingConfigured()

  const activeSpend = o.config.pricing_mode === 'custom' ? o.month_custom : o.month_openrouter
  const limit = o.config.monthly_limit_usd
  const pct = limit && limit > 0 ? Math.min(100, (activeSpend / limit) * 100) : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 font-mono text-[12px]">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1 font-sans">AI 预算</h1>
      <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// AI BUDGET · '}{o.config.pricing_mode.toUpperCase()}{' MODE'}
      </p>

      {/* this-month spend */}
      <section className="border border-ark-border p-4 mb-6">
        <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-3">{'//'} 本月用量</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="OpenRouter 实际" value={usd(o.month_openrouter)} accent={o.config.pricing_mode === 'openrouter'} />
          <Stat label="自定义计价" value={usd(o.month_custom)} accent={o.config.pricing_mode === 'custom'} />
          <Stat label="请求 / tokens" value={`${o.requests} / ${o.total_tokens}`} />
        </div>
        {pct != null && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-ark-muted mb-1">
              <span>{usd(activeSpend)} / {usd(limit!)}</span>
              <span>{pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-ark-surface border border-ark-border">
              <div className="h-full bg-ark-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </section>

      <BudgetForm config={o.config} />
      <AccessPanel initial={access} />
      <SummariesPanel />
      <RelationsPanel />
      <PlansPanel initial={plans} configured={stripeOn} />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className={`text-lg ${accent ? 'text-ark-accent' : 'text-ark-text'}`}>{value}</p>
      <p className="text-[9px] text-ark-muted tracking-widest uppercase mt-0.5">{label}</p>
    </div>
  )
}
