'use client'

import { Turnstile } from '@marsidev/react-turnstile'

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/** Whether Turnstile is configured on the client (site key present). */
export const turnstileConfigured = !!SITE_KEY

/**
 * Cloudflare Turnstile widget (AP-8). Renders nothing when no site key is
 * configured, so forms work unprotected until Cloudflare is wired up. Reports
 * the token (or null on expire/error) via `onToken`. Bump `remountKey` to
 * force a fresh challenge after a successful submit (tokens are single-use).
 */
export default function TurnstileWidget({
  onToken,
  remountKey = 0,
}: {
  onToken: (token: string | null) => void
  remountKey?: number
}) {
  if (!SITE_KEY) return null
  return (
    <Turnstile
      key={remountKey}
      siteKey={SITE_KEY}
      options={{ size: 'flexible', theme: 'dark' }}
      onSuccess={t => onToken(t)}
      onExpire={() => onToken(null)}
      onError={() => onToken(null)}
      className="my-1"
    />
  )
}
