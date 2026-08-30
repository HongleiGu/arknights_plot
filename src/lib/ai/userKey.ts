// Encryption for user-supplied API keys (035). Server-only.
//
// AES-256-GCM under a 32-byte key derived from AI_KEY_SECRET. GCM is
// authenticated, so a tampered ciphertext fails to decrypt rather than
// silently yielding garbage that we'd then send to a provider as a bearer
// token.
//
// The plaintext key and AI_KEY_SECRET never reach Postgres — that's the whole
// reason this lives in the app rather than in pgcrypto, where the secret would
// travel as a SQL argument and could surface in query logs.
//
// Rotating AI_KEY_SECRET invalidates every stored key. That's the intended
// failure mode: users re-enter theirs, and a database dump on its own is inert.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const SECRET = process.env.AI_KEY_SECRET

/** True when user-supplied keys can be stored at all. */
export function keyStorageConfigured(): boolean {
  return !!SECRET && SECRET.length >= 16
}

/**
 * 32 bytes from the configured secret. SHA-256 rather than a KDF with a salt
 * because there is no per-record salt to store and the input is a
 * high-entropy server secret, not a user password — stretching buys nothing
 * against an attacker who already has the secret.
 */
function derivedKey(): Buffer {
  if (!keyStorageConfigured()) throw new Error('AI_KEY_SECRET 未配置（至少 16 位）')
  return createHash('sha256').update(SECRET!).digest()
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64url. */
export function encryptKey(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':')
}

/** Returns null for anything that doesn't decrypt — wrong secret, tampering. */
export function decryptKey(stored: string): string | null {
  try {
    const [v, ivB64, tagB64, ctB64] = stored.split(':')
    if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) return null
    const decipher = createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/** Last 4 characters, for "…a1b2" in the UI. Never enough to use. */
export function keyHint(plain: string): string {
  return plain.length <= 4 ? '••••' : plain.slice(-4)
}
