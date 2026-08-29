// Stripe webhook (AP-21) — the ONLY writer of subscription state.
//
// Trust model: the request is authenticated by Stripe's signature over the raw
// body, verified before anything is read or written. Only after that do we use
// the service-role client (see lib/supabase/admin.ts for why this is the one
// sanctioned RLS bypass). 031 gives `subscriptions` no client write policy, so
// a plan can never be self-granted from the browser.
//
// Idempotency: every event id is inserted into billing_events first; a
// duplicate insert (Stripe retries, or replays) short-circuits the handler.
//
// Setup:
//   stripe listen --forward-to localhost:3000/api/billing/webhook
//   → put the printed whsec_… in STRIPE_WEBHOOK_SECRET
// Subscribe to: checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted.

import type Stripe from 'stripe'
import { stripe, stripeConfigured, webhookSecret } from '@/lib/billing/stripe'
import { createAdminClient, serviceRoleConfigured } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Db = ReturnType<typeof createAdminClient>

export async function POST(req: Request) {
  if (!stripeConfigured() || !serviceRoleConfigured()) {
    return new Response('billing not configured', { status: 503 })
  }
  const secret = webhookSecret()
  if (!secret) return new Response('missing STRIPE_WEBHOOK_SECRET', { status: 503 })

  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('missing signature', { status: 400 })

  // Must be the raw body — constructEvent re-computes the HMAC over these bytes.
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret)
  } catch (e) {
    return new Response(`signature verification failed: ${e instanceof Error ? e.message : ''}`, { status: 400 })
  }

  const db = createAdminClient()

  // Idempotency gate: UNIQUE(stripe_event_id) makes the second delivery a no-op.
  const { error: dupe } = await db.from('billing_events').insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: event.data.object as unknown as Record<string, unknown>,
  })
  if (dupe) {
    // 23505 = unique violation → already handled. Anything else is a real fault,
    // so return 500 and let Stripe retry rather than silently dropping the event.
    if (dupe.code === '23505') return Response.json({ received: true, duplicate: true })
    return new Response(`ledger write failed: ${dupe.message}`, { status: 500 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        // Subscription mode only; one-off payments aren't sold today.
        if (s.mode !== 'subscription' || !s.subscription) break
        const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription.id
        const full = await stripe().subscriptions.retrieve(subId)
        await syncSubscription(db, full, userIdFromSession(s))
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(db, sub, null)
        break
      }
      default:
        // Recorded in billing_events for audit; no state change needed.
        break
    }
  } catch (e) {
    // Signal failure so Stripe retries. The billing_events row stays, so the
    // retry would be swallowed as a duplicate — delete it to keep it replayable.
    await db.from('billing_events').delete().eq('stripe_event_id', event.id)
    return new Response(`handler failed: ${e instanceof Error ? e.message : ''}`, { status: 500 })
  }

  return Response.json({ received: true })
}

/** Our users.id, as stamped on the Checkout session. */
function userIdFromSession(s: Stripe.Checkout.Session): number | null {
  const raw = s.client_reference_id ?? s.metadata?.app_user_id
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Mirror a Stripe subscription into `subscriptions`.
 *
 * Resolving our user: the metadata we stamped at checkout, else the hint from
 * the session, else an existing row for this Stripe customer. If none of those
 * resolve we skip rather than guess — a mis-attributed plan is worse than a
 * missing one, and the event stays in billing_events for inspection.
 */
async function syncSubscription(db: Db, sub: Stripe.Subscription, hintUserId: number | null): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  const metaId = parseInt(sub.metadata?.app_user_id ?? '', 10)
  let userId: number | null = Number.isFinite(metaId) ? metaId : hintUserId
  if (userId == null) {
    const { data } = await db
      .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
    userId = data?.user_id ?? null
  }
  if (userId == null) return

  // Map the Stripe Price back to our plan; fall back to the plan_code metadata.
  const priceId = sub.items.data[0]?.price?.id ?? null
  let planId: number | null = null
  if (priceId) {
    const { data } = await db.from('billing_plans').select('id').eq('stripe_price_id', priceId).maybeSingle()
    planId = data?.id ?? null
  }
  if (planId == null && sub.metadata?.plan_code) {
    const { data } = await db.from('billing_plans').select('id').eq('code', sub.metadata.plan_code).maybeSingle()
    planId = data?.id ?? null
  }

  // current_period_end lives on the subscription item in recent API versions.
  const periodEnd = sub.items.data[0]?.current_period_end ?? null

  await db.from('subscriptions').upsert(
    {
      user_id: userId,
      plan_id: planId,
      status: sub.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
}
