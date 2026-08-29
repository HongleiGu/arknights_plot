// Shared helpers for token-spending admin jobs (chapter/story summaries AP-23,
// relation extraction AP-22 P2). Admin + budget gate, one-shot completion with
// OpenRouter cost capture, and ledger recording — all reusing the AP-17 budget
// tables so every job's spend shows up in /admin/ai automatically. Server-only.

import type OpenAI from 'openai'
import { AI_MODEL, aiConfigured, llm } from '@/lib/ai/llm'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/app/actions/comments'

export type Db = Awaited<ReturnType<typeof createClient>>
export type AiUsage = { prompt: number; completion: number; total: number; cached: number; cost: number }

/** Admin + budget gate. Returns the authed db + user id, or a friendly error. */
export async function aiGuard(): Promise<{ db: Db; id: number } | { error: string }> {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { error: '未登录' }
  if (!(await isCurrentUserAdmin())) return { error: '无权限（仅管理员）' }
  if (!aiConfigured()) return { error: 'AI 未配置' }
  const { data: me } = await db.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  if (!me) return { error: '未登录' }
  const { data: chk } = await db.rpc('ai_budget_check', { p_user: me.id })
  const b = (Array.isArray(chk) ? chk[0] : chk) as { allowed: boolean } | null
  if (b && b.allowed === false) return { error: 'AI 预算已用尽' }
  return { db, id: me.id }
}

/** One-shot completion; returns text + token/cost usage (OpenRouter cost when returned). */
export async function aiComplete(system: string, user: string): Promise<{ text: string; usage: AiUsage }> {
  const params = {
    model: AI_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  ;(params as unknown as { usage?: { include: boolean } }).usage = { include: true }
  const r = await llm().chat.completions.create(params)
  const u = r.usage
  return {
    text: (r.choices[0]?.message?.content ?? '').trim(),
    usage: {
      prompt: u?.prompt_tokens ?? 0,
      completion: u?.completion_tokens ?? 0,
      total: u?.total_tokens ?? 0,
      cached: (u?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0,
      cost: (u as unknown as { cost?: number })?.cost ?? 0,
    },
  }
}

/** Write one ai_usage ledger row (dual cost), reusing the AP-17 budget config. */
export async function recordSpend(db: Db, userId: number, u: AiUsage): Promise<void> {
  const { data: cfg } = await db.from('ai_budget_config').select('input_price_per_m, output_price_per_m').maybeSingle()
  const costCustom = (u.prompt / 1e6) * Number(cfg?.input_price_per_m ?? 0) + (u.completion / 1e6) * Number(cfg?.output_price_per_m ?? 0)
  await db.from('ai_usage').insert({
    user_id: userId, model: AI_MODEL,
    prompt_tokens: u.prompt, completion_tokens: u.completion, total_tokens: u.total, cached_tokens: u.cached,
    cost_openrouter: u.cost > 0 ? u.cost : null, cost_custom: costCustom,
  })
}
