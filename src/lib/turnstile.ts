// Cloudflare Turnstile server-side verification (AP-8).
//
// Graceful no-op when unconfigured: if TURNSTILE_SECRET_KEY is unset, every
// token verifies as OK, so the app works before Cloudflare is wired up. Once
// the secret is set, a valid token is required.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY
}

export async function verifyTurnstile(token: string | null | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true            // not configured → verification disabled
  if (!token) return false

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    })
    const data = (await res.json()) as { success?: boolean }
    return !!data.success
  } catch {
    return false
  }
}
