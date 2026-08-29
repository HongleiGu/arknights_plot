import { createClient } from '@/lib/supabase/server'
import { billingConfigured, listPlans, myBillingStatus } from '@/app/actions/billing'
import PlanCards from './PlanCards'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  none: '未订阅', active: '生效中', trialing: '试用中', past_due: '逾期未付',
  canceled: '已取消', unpaid: '未支付', paused: '已暂停',
  incomplete: '待完成支付', incomplete_expired: '支付已过期',
}

export default async function PricingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [plans, status, configured] = await Promise.all([
    listPlans(),
    myBillingStatus(),
    billingConfigured(),
  ])

  const used = status ? status.spent_usd : 0
  const cap = status?.limit_usd ?? null
  const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">订阅方案</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// PRICING · AI 额度'}
      </p>

      <p className="text-sm text-ark-muted mb-8 leading-relaxed">
        阅读、批注与线索板始终免费。订阅只影响 <span className="text-ark-text">AI 分析终端</span> 的每月额度——
        按实际调用的模型成本计量，用满即停，不会超额扣费。
      </p>

      {/* current usage */}
      {status && (
        <section className="border border-ark-border p-4 mb-8 font-mono text-[11px]">
          <p className="text-ark-muted tracking-widest uppercase mb-2">{'//'} 本月用量</p>
          <p className="text-ark-text">
            {status.plan_name}
            <span className="text-ark-muted"> · {STATUS_LABEL[status.status] ?? status.status}</span>
            {status.cancel_at_period_end && <span className="text-ark-danger"> · 到期后取消</span>}
          </p>
          <p className="text-ark-muted mt-1">
            ${used.toFixed(4)} {cap == null ? '/ 不限' : `/ $${cap.toFixed(2)}`}
            {status.period_end && (
              <span className="text-ark-border"> · 续订于 {status.period_end.slice(0, 10)}</span>
            )}
          </p>
          {cap != null && cap > 0 && (
            <div className="mt-2 h-1 bg-ark-border/40">
              <div
                className={pct >= 100 ? 'h-full bg-ark-danger' : 'h-full bg-ark-accent'}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </section>
      )}

      <PlanCards plans={plans} status={status} configured={configured} signedIn={!!user} />

      {!configured && (
        <p className="mt-8 font-mono text-[10px] text-ark-border tracking-widest uppercase">
          {'//'} 支付通道尚未配置（STRIPE_SECRET_KEY）——当前所有用户按免费额度计费
        </p>
      )}
    </div>
  )
}
