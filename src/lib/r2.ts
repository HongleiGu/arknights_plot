// Cloudflare R2 upload helper for user-supplied media (AP-10). Mirrors the
// Python upload scripts: bucket `arknights-assets`, S3 API at
// https://<account>.r2.cloudflarestorage.com, public URL via
// NEXT_PUBLIC_R2_PUBLIC_URL. Objects land under <prefix>/<sha1>.<ext>
// (content hash → identical images dedupe, across prefixes too).

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'

const BUCKET = process.env.R2_BUCKET || 'arknights-assets'
const PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function r2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    PUBLIC
  )
}

let client: S3Client | null = null
function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}

/**
 * Upload image bytes to R2, returning the public URL. Throws on bad type.
 * `prefix` separates comment attachments from board node images; the object
 * name stays the content hash either way.
 */
export async function uploadImage(
  bytes: Uint8Array, contentType: string, prefix = 'comment-media',
): Promise<string> {
  const ext = EXT[contentType]
  if (!ext) throw new Error('unsupported image type')

  const sha1 = createHash('sha1').update(bytes).digest('hex')
  const key = `${prefix}/${sha1}.${ext}`

  await r2().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return `${PUBLIC}/${key}`
}

/** Back-compat alias for the AP-10 comment upload path. */
export const uploadCommentImage = (bytes: Uint8Array, contentType: string) =>
  uploadImage(bytes, contentType, 'comment-media')
