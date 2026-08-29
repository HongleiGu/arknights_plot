'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'

/** Who may use the assistant. 'subscriber' arrives with billing (AP-21). */
export type AccessMode = 'admin' | 'allowlist' | 'subscriber' | 'all'

export interface BudgetConfig {
  pricing_mode: 'openrouter' | 'custom'
  access_mode: AccessMode
  input_price_per_m: number
  output_price_per_m: number
  monthly_limit_usd: number | null
  per_user_limit_usd: number | null
  max_steps: number
}

export interface AiAccessEntry {
  user_id: number
  display_name: string | null
  ai_access: 'allow' | 'block' | null
  ai_limit_usd: number | null
}

export interface BudgetOverview {
  config: BudgetConfig
  month_openrouter: number   // this-month spend, OpenRouter actual (USD)
  month_custom: number       // this-month spend, our custom pricing (USD)
  requests: number
  total_tokens: number
}

function monthStartISO(): string {
  const d = new Date()
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getBudgetOverview(): Promise<BudgetOverview | null> {
  if (!(await isCurrentUserAdmin())) return null
  const db = await createClient()

  const { data: cfg } = await db.from('ai_budget_config').select('*').maybeSingle()
  const { data: rows } = await db.from('ai_usage')
    .select('cost_openrouter, cost_custom, total_tokens')
    .gte('created_at', monthStartISO())

  let mo = 0, mc = 0, tok = 0
  for (const r of rows ?? []) {
    mo += Number(r.cost_openrouter ?? 0)
    mc += Number(r.cost_custom ?? 0)
    tok += Number(r.total_tokens ?? 0)
  }

  return {
    config: {
      pricing_mode: (cfg?.pricing_mode ?? 'openrouter') as 'openrouter' | 'custom',
      access_mode: (cfg?.access_mode ?? 'admin') as AccessMode,
      input_price_per_m: Number(cfg?.input_price_per_m ?? 0),
      output_price_per_m: Number(cfg?.output_price_per_m ?? 0),
      monthly_limit_usd: cfg?.monthly_limit_usd != null ? Number(cfg.monthly_limit_usd) : null,
      per_user_limit_usd: cfg?.per_user_limit_usd != null ? Number(cfg.per_user_limit_usd) : null,
      max_steps: Number(cfg?.max_steps ?? 8),
    },
    month_openrouter: mo,
    month_custom: mc,
    requests: (rows ?? []).length,
    total_tokens: tok,
  }
}

export async function updateBudgetConfig(fields: Partial<BudgetConfig>): Promise<{ ok: boolean; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: '无权限' }
  const db = await createClient()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.pricing_mode) patch.pricing_mode = fields.pricing_mode
  if (fields.access_mode) patch.access_mode = fields.access_mode
  if (fields.input_price_per_m !== undefined) patch.input_price_per_m = fields.input_price_per_m
  if (fields.output_price_per_m !== undefined) patch.output_price_per_m = fields.output_price_per_m
  if (fields.monthly_limit_usd !== undefined) patch.monthly_limit_usd = fields.monthly_limit_usd
  if (fields.per_user_limit_usd !== undefined) patch.per_user_limit_usd = fields.per_user_limit_usd
  // 0 = unlimited (app-side hard cap + budget still apply); 1..24 = explicit cap.
  if (fields.max_steps !== undefined) patch.max_steps = Math.min(Math.max(fields.max_steps, 0), 24)
  // RLS: only an admin can UPDATE ai_budget_config.
  const { error } = await db.from('ai_budget_config').update(patch).eq('id', 1)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ai')
  return { ok: true }
}

// ---- per-user AI access (AP-18) --------------------------------------------

const ACCESS_ERRORS: Record<string, string> = {
  not_admin: '无权限',
  invalid_access: '取值无效',
  no_such_user: '没有找到使用该邮箱的用户',
}

export async function listAiAccess(): Promise<AiAccessEntry[]> {
  if (!(await isCurrentUserAdmin())) return []
  const db = await createClient()
  const { data } = await db.rpc('list_ai_access')
  return (data ?? []) as AiAccessEntry[]
}

/** Set (or clear) a user's AI access + optional per-user monthly cap, by email. */
export async function setUserAiAccess(
  email: string,
  access: 'allow' | 'block' | null,
  limitUsd: number | null,
): Promise<{ ok: true; user_id: number; display_name: string | null } | { ok: false; error: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: '无权限' }
  email = email.trim()
  if (!email) return { ok: false, error: '请输入邮箱' }
  const db = await createClient()
  const { data, error } = await db.rpc('set_user_ai_access', {
    p_email: email, p_access: access, p_limit: limitUsd,
  })
  if (error) {
    const key = Object.keys(ACCESS_ERRORS).find(k => error.message.includes(k))
    return { ok: false, error: key ? ACCESS_ERRORS[key] : error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  revalidatePath('/admin/ai')
  return { ok: true, user_id: row.user_id, display_name: row.display_name ?? null }
}
