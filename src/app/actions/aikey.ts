'use server'

// Bring-your-own API key (035). The user pastes a provider key; we store only
// its ciphertext and show only the last four characters back.
//
// The plaintext is never returned to the browser after it's saved — not even
// to the owner. Re-entering a key is cheap; leaking one through a page that
// happened to be cached or screenshotted is not.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { decryptKey, encryptKey, keyHint, keyStorageConfigured } from '@/lib/ai/userKey'

export interface AiKeyStatus {
  /** Whether this deployment can store keys at all (AI_KEY_SECRET present). */
  configured: boolean
  present: boolean
  provider: string | null
  hint: string | null
  updated_at: string | null
}

async function myUserId(): Promise<{ db: Awaited<ReturnType<typeof createClient>>; id: number } | null> {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return null
  const { data } = await db.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
  return data ? { db, id: data.id } : null
}

export async function getAiKeyStatus(): Promise<AiKeyStatus> {
  const base: AiKeyStatus = {
    configured: keyStorageConfigured(),
    present: false, provider: null, hint: null, updated_at: null,
  }
  const me = await myUserId()
  if (!me) return base
  // RLS restricts this to the caller's own row.
  const { data } = await me.db
    .from('user_ai_keys')
    .select('provider, key_hint, updated_at')
    .eq('user_id', me.id)
    .maybeSingle()
  if (!data) return base
  return {
    ...base,
    present: true,
    provider: data.provider,
    hint: data.key_hint,
    updated_at: data.updated_at,
  }
}

export async function saveAiKey(
  rawKey: string,
  provider = 'openrouter',
): Promise<{ ok: true; hint: string } | { ok: false; error: string }> {
  const key = rawKey.trim()
  if (!key) return { ok: false, error: '请输入 API Key' }
  // Loose sanity check only — providers differ, and rejecting a valid-but-
  // unfamiliar key would be worse than letting the provider reject it.
  if (key.length < 16 || /\s/.test(key)) return { ok: false, error: 'API Key 格式看起来不正确' }
  if (!keyStorageConfigured()) {
    return { ok: false, error: '本站未配置密钥存储（缺少 AI_KEY_SECRET），请联系管理员' }
  }
  const me = await myUserId()
  if (!me) return { ok: false, error: '请先登录' }

  const hint = keyHint(key)
  const { error } = await me.db.from('user_ai_keys').upsert(
    {
      user_id: me.id,
      provider: provider.trim() || 'openrouter',
      ciphertext: encryptKey(key),
      key_hint: hint,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings')
  return { ok: true, hint }
}

export async function clearAiKey(): Promise<{ ok: boolean }> {
  const me = await myUserId()
  if (!me) return { ok: false }
  const { error } = await me.db.from('user_ai_keys').delete().eq('user_id', me.id)
  revalidatePath('/settings')
  return { ok: !error }
}

/**
 * The caller's decrypted key, for the assistant route. Never exposed to the
 * client — this is imported by server code only, and returns null when there's
 * no key or the stored ciphertext no longer decrypts (rotated AI_KEY_SECRET).
 */
export async function resolveCallerKey(): Promise<{ key: string; provider: string } | null> {
  if (!keyStorageConfigured()) return null
  const me = await myUserId()
  if (!me) return null
  const { data } = await me.db
    .from('user_ai_keys')
    .select('provider, ciphertext')
    .eq('user_id', me.id)
    .maybeSingle()
  if (!data) return null
  const key = decryptKey(data.ciphertext)
  return key ? { key, provider: data.provider } : null
}
