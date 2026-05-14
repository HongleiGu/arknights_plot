/**
 * Keep-alive ping for Supabase free-tier projects.
 *
 * Supabase pauses projects after ~7 days of zero activity. This route is
 * called daily by Vercel cron (see vercel.json) to register one DB read
 * and one Storage metadata call — both lightweight, both enough to count
 * as "active" by Supabase's metering.
 *
 * We deliberately do NOT download image bytes: that would burn egress
 * quota for no benefit. Storage activity is registered by any request,
 * including cheap metadata calls like `list`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Force a fresh hit on every invocation — don't let edge caching skip the DB.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const supabase = await createClient()
  const ts = new Date().toISOString()

  // ---- DB ping: count rows. `head: true` skips returning the rows. ----
  const { count, error: dbError } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })

  if (dbError) {
    return NextResponse.json(
      { ok: false, ts, where: 'db', error: dbError.message },
      { status: 500 },
    )
  }

  // ---- Storage ping: list one object's metadata (no bytes downloaded) ----
  const { data: listing, error: storageError } = await supabase.storage
    .from('data')
    .list('story-titles', { limit: 1 })

  if (storageError) {
    return NextResponse.json(
      { ok: false, ts, where: 'storage', error: storageError.message, db_count: count },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    ts,
    db_count: count,
    storage_objects_listed: listing?.length ?? 0,
  })
}
