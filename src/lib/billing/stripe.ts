// Stripe client for AP-21. Server-only.
//
// Ships unconfigured on purpose (the AP-8 Turnstile precedent): with no
// STRIPE_SECRET_KEY the whole billing surface degrades to "read-only pricing
// page + free tier". Nothing throws at import time, so the app boots fine
// without any Stripe account at all.
//
// .env keys:
//   STRIPE_SECRET_KEY       sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET   whsec_…   (from `stripe listen` or the dashboard)
//   NEXT_PUBLIC_SITE_URL    absolute site origin, for checkout return URLs

import Stripe from 'stripe'

const SECRET = process.env.STRIPE_SECRET_KEY

/** True when checkout / portal / webhook can actually run. */
export function stripeConfigured(): boolean {
  return !!SECRET
}

export function webhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET
}

/** Absolute origin for Stripe return URLs. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

let client: Stripe | null = null

/** The Stripe client. Throws when unconfigured — callers gate on stripeConfigured(). */
export function stripe(): Stripe {
  if (!SECRET) throw new Error('Stripe 未配置（缺少 STRIPE_SECRET_KEY）')
  if (!client) client = new Stripe(SECRET)
  return client
}
