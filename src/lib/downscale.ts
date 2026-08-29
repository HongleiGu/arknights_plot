'use client'

// Shrink an image in the browser before uploading it (033 board node images).
//
// A phone photo is routinely 4-8 MB, which would bounce off the 2 MB server cap
// and waste R2 either way — a board card never renders larger than ~600px. We
// re-encode to WebP, which is typically 25-35% smaller than JPEG at the same
// visual quality and is supported by every browser that can run this app.
//
// Returns the ORIGINAL file untouched when shrinking wouldn't help: GIFs (a
// canvas round-trip would flatten the animation to one frame) and images
// already small enough. Failing to decode is non-fatal — the caller uploads
// the original and the server-side cap still applies.

export interface Downscaled {
  file: File
  width: number
  height: number
}

const MAX_DIM = 1600      // longest edge; comfortably above any card render size
const QUALITY = 0.82
const SKIP_UNDER = 256 * 1024

export async function downscaleImage(file: File): Promise<Downscaled> {
  const passthrough = async (): Promise<Downscaled> => {
    const dim = await imageSize(file).catch(() => ({ width: 0, height: 0 }))
    return { file, width: dim.width, height: dim.height }
  }

  // Animated GIFs must not go through a canvas — it would keep frame 1 only.
  if (file.type === 'image/gif') return passthrough()

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return passthrough()
  }

  const { width: w0, height: h0 } = bitmap
  const scale = Math.min(1, MAX_DIM / Math.max(w0, h0))
  // Already small in both bytes and pixels — re-encoding would only lose detail.
  if (scale === 1 && file.size <= SKIP_UNDER) {
    bitmap.close()
    return { file, width: w0, height: h0 }
  }

  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { file, width: w0, height: h0 }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>(res =>
    canvas.toBlob(res, 'image/webp', QUALITY),
  )
  // Keep the original if the encode failed, or somehow came out bigger.
  if (!blob || blob.size >= file.size) return { file, width: w0, height: h0 }

  const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
  return { file: new File([blob], name, { type: 'image/webp' }), width, height }
}

/** Intrinsic dimensions without re-encoding. */
async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}
