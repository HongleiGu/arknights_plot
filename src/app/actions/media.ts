'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Configured, uploadCommentImage } from '@/lib/r2'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/**
 * Upload a comment image to R2 (AP-10). Auth-gated; enforces type + size.
 * Per-comment image count is enforced client-side (it's a property of the
 * draft, not a single upload). Returns the public URL.
 */
export async function uploadCommentImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not signed in' }
  if (!r2Configured()) return { ok: false, error: '图片存储未配置' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'no file' }
  if (!TYPES.includes(file.type)) return { ok: false, error: '仅支持 png / jpg / gif / webp' }
  if (file.size > MAX_BYTES) return { ok: false, error: '图片超过 2MB' }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const url = await uploadCommentImage(bytes, file.type)
    return { ok: true, url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'upload failed' }
  }
}
