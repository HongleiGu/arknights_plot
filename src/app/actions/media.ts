'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Configured, uploadImage } from '@/lib/r2'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Shared gate: signed in, storage configured, allowed type, under the cap. */
async function uploadGuard(file: unknown): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not signed in' }
  if (!r2Configured()) return { ok: false, error: '图片存储未配置' }
  if (!(file instanceof File)) return { ok: false, error: 'no file' }
  if (!TYPES.includes(file.type)) return { ok: false, error: '仅支持 png / jpg / gif / webp' }
  if (file.size > MAX_BYTES) return { ok: false, error: '图片超过 2MB' }
  return { ok: true, file }
}

/**
 * Upload a board node image (033). Same gate as comment media, different R2
 * prefix. The client downscales before sending (see lib/downscale.ts), so the
 * 2MB cap is a backstop rather than something a normal photo would hit.
 */
export async function uploadBoardImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const guard = await uploadGuard(formData.get('file'))
  if (!guard.ok) return guard
  try {
    const bytes = new Uint8Array(await guard.file.arrayBuffer())
    return { ok: true, url: await uploadImage(bytes, guard.file.type, 'board-media') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'upload failed' }
  }
}

/**
 * Upload a comment image to R2 (AP-10). Auth-gated; enforces type + size.
 * Per-comment image count is enforced client-side (it's a property of the
 * draft, not a single upload). Returns the public URL.
 */
export async function uploadCommentImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const guard = await uploadGuard(formData.get('file'))
  if (!guard.ok) return guard
  try {
    const bytes = new Uint8Array(await guard.file.arrayBuffer())
    return { ok: true, url: await uploadImage(bytes, guard.file.type, 'comment-media') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'upload failed' }
  }
}
