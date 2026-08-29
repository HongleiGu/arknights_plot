// Service-role Supabase client — RLS is BYPASSED here.
//
// AP-19 established that application code (and every AI tool) must read and
// write under the caller's own RLS. This client is the one deliberate
// exception, and exists for exactly one caller: the Stripe billing webhook
// (src/app/api/billing/webhook/route.ts).
//
// Why it has to exist: a webhook request has no signed-in user, so there is no
// RLS identity to act under, yet it must write subscription state. Its
// authentication is Stripe's request signature, verified before this client is
// ever constructed. Correspondingly, 031 gives `subscriptions` no client-side
// write policy at all — the only way a plan is granted is a signed Stripe
// event, so a user can never upgrade themselves.
//
// Do not import this anywhere else. If you need data as a user, use
// lib/supabase/server.ts; if you need a privileged read for a gate, add a
// SECURITY DEFINER function instead (see 022 / 023 / 031).

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

export function serviceRoleConfigured(): boolean {
  return !!(process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL))
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL')
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
