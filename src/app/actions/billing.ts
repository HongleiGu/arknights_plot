'use server'

// Subscriptions / checkout / customer portal (AP-21).
//
// Stripe holds the money and the truth about subscription state; these actions
// only start a hosted Checkout or Portal session and read the mirrored state
// that the webhook writes. Nothing here grants a plan — 031 gives
// `subscriptions` no client write policy, so entitlement can only come from a
// signed Stripe event.
//
// Everything degrades gracefully when Stripe is unconfigured: plans still
// list, `startCheckout` returns a friendly error, and every user sits on the
// free tier.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { siteUrl, stripe, stripeConfigured } from '@/lib/billing/stripe'

export interface Plan {
  id: number
  code: string
  name: string
  description: string | null
  monthly_price_usd: number
  monthly_ai_limit_usd: number | null
  is_active: boolean
  /** Whether this plan can actually be bought (needs a Stripe price id + key). */
  purchasable: boolean
  seq: number
}

export interface BillingStatus {
  plan_code: string
  plan_name: string
  /** Stripe status, or 'none' when the user has never subscribed. */
  status: string
  period_end: string | null
  cancel_at_period_end: boolean
  /** Monthly AI allowance in USD; null = unlimited. */
  limit_usd: number | null
  spent_usd: number
}

/** True when the deployment has Stripe wired up (drives the pricing CTA). */
export async function billingConfigured(): Promise<boolean> {
  return stripeConfigured()
}

/** The public plan ladder, cheapest first. */
export async function listPlans(): Promise<Plan[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('billing_plans')
    .select('id, code, name, description, monthly_price_usd, monthly_ai_limit_usd, stripe_price_id, is_active, seq')
    .eq('is_active', true)
    .order('seq', { ascending: true })

  const configured = stripeConfigured()
  return (data ?? []).map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    monthly_price_usd: Number(p.monthly_price_usd ?? 0),
    monthly_ai_limit_usd: p.monthly_ai_limit_usd == null ? null : Number(p.monthly_ai_limit_usd),
    is_active: p.is_active,
    purchasable: configured && !!p.stripe_price_id && Number(p.monthly_price_usd ?? 0) > 0,
    seq: p.seq,
  }))
}

/** The caller's plan + this month's usage. Null when signed out. */
export async function myBillingStatus(): Promise<BillingStatus | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_billing_status')
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) return null
  return {
    plan_code: String(row.plan_code ?? 'free'),
    plan_name: String(row.plan_name ?? '免费'),
    status: String(row.status ?? 'none'),
    period_end: (row.period_end as string | null) ?? null,
    cancel_at_period_end: !!row.cancel_at_period_end,
    limit_usd: row.limit_usd == null ? null : Number(row.limit_usd),
    spent_usd: Number(row.spent_usd ?? 0),
  }
}

/** Resolve the signed-in caller's users row (id + email) for Stripe. */
async function callerForStripe() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  if (!data) return null
  // Read the existing customer id, if the user has subscribed before.
  const { data: sub } = await supabase
    .from('subscriptions').select('stripe_customer_id').eq('user_id', data.id).maybeSingle()
  return { supabase, userId: data.id, email: user.email ?? undefined, customerId: sub?.stripe_customer_id ?? null }
}

/**
 * Start a hosted Checkout for `planCode`. Returns a URL for the client to
 * redirect to. The resulting subscription reaches us via the webhook, never
 * from the browser — the success redirect is only cosmetic.
 */
export async function startCheckout(
  planCode: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!stripeConfigured()) return { ok: false, error: '支付未配置（缺少 STRIPE_SECRET_KEY）' }

  const who = await callerForStripe()
  if (!who) return { ok: false, error: '请先登录' }

  const { data: plan } = await who.supabase
    .from('billing_plans')
    .select('id, code, name, stripe_price_id, monthly_price_usd, is_active')
    .eq('code', planCode)
    .maybeSingle()
  if (!plan || !plan.is_active) return { ok: false, error: '套餐不可用' }
  if (!plan.stripe_price_id) return { ok: false, error: '该套餐尚未配置 Stripe 价格' }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${siteUrl()}/pricing?checkout=success`,
      cancel_url: `${siteUrl()}/pricing?checkout=cancelled`,
      // Reuse the customer across purchases when we know it; otherwise let
      // Stripe create one and prefill the email.
      ...(who.customerId ? { customer: who.customerId } : { customer_email: who.email }),
      // The webhook maps the subscription back to our user with this.
      client_reference_id: String(who.userId),
      subscription_data: {
        metadata: { app_user_id: String(who.userId), plan_code: plan.code },
      },
      metadata: { app_user_id: String(who.userId), plan_code: plan.code },
      allow_promotion_codes: true,
    })
    if (!session.url) return { ok: false, error: '创建结账会话失败' }
    return { ok: true, url: session.url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '创建结账会话失败' }
  }
}

/** Open Stripe's billing portal so the user can change or cancel their plan. */
export async function openBillingPortal(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!stripeConfigured()) return { ok: false, error: '支付未配置（缺少 STRIPE_SECRET_KEY）' }
  const who = await callerForStripe()
  if (!who) return { ok: false, error: '请先登录' }
  if (!who.customerId) return { ok: false, error: '还没有订阅记录' }
  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: who.customerId,
      return_url: `${siteUrl()}/pricing`,
    })
    return { ok: true, url: portal.url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '打开账单门户失败' }
  }
}

// ---- admin: edit the plan ladder -------------------------------------------

export interface AdminPlan extends Plan {
  stripe_price_id: string | null
}

/** Every plan including inactive ones, with the Stripe price id (admin view). */
export async function listPlansAdmin(): Promise<AdminPlan[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('billing_plans')
    .select('id, code, name, description, monthly_price_usd, monthly_ai_limit_usd, stripe_price_id, is_active, seq')
    .order('seq', { ascending: true })
  const configured = stripeConfigured()
  return (data ?? []).map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    monthly_price_usd: Number(p.monthly_price_usd ?? 0),
    monthly_ai_limit_usd: p.monthly_ai_limit_usd == null ? null : Number(p.monthly_ai_limit_usd),
    stripe_price_id: p.stripe_price_id,
    is_active: p.is_active,
    purchasable: configured && !!p.stripe_price_id && Number(p.monthly_price_usd ?? 0) > 0,
    seq: p.seq,
  }))
}

/** Update one plan. RLS restricts billing_plans writes to admins. */
export async function updatePlan(
  id: number,
  fields: {
    name?: string
    description?: string | null
    monthly_price_usd?: number
    monthly_ai_limit_usd?: number | null
    stripe_price_id?: string | null
    is_active?: boolean
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.name != null) patch.name = fields.name.trim()
  if (fields.description !== undefined) patch.description = fields.description?.trim() || null
  if (fields.monthly_price_usd != null) patch.monthly_price_usd = fields.monthly_price_usd
  if (fields.monthly_ai_limit_usd !== undefined) patch.monthly_ai_limit_usd = fields.monthly_ai_limit_usd
  if (fields.stripe_price_id !== undefined) patch.stripe_price_id = fields.stripe_price_id?.trim() || null
  if (fields.is_active != null) patch.is_active = fields.is_active

  const { error } = await supabase.from('billing_plans').update(patch).eq('id', id)
  revalidatePath('/pricing')
  revalidatePath('/admin/ai')
  return error ? { ok: false, error: error.message } : { ok: true }
}
