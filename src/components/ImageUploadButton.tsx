'use client'

import { useRef, useState } from 'react'
import { uploadCommentImageAction } from '@/app/actions/media'

const MAX_IMAGES = 4
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Comment image upload (AP-10): a small button that picks an image, uploads it
 * to R2, and hands back a markdown `![](url)` to insert. Renders nothing if R2
 * isn't configured. Enforces the per-comment image cap from `imageCount`.
 */
export default function ImageUploadButton({
  imageCount,
  onImage,
}: {
  imageCount: number
  onImage: (markdown: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!process.env.NEXT_PUBLIC_R2_PUBLIC_URL) return null
  const atLimit = imageCount >= MAX_IMAGES

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setErr(null)
    if (file.size > MAX_BYTES) { setErr('图片超过 2MB'); return }

    setBusy(true)
    const fd = new FormData()
    fd.set('file', file)
    const res = await uploadCommentImageAction(fd)
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    onImage(`![image](${res.url})`)
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy || atLimit}
        onClick={() => inputRef.current?.click()}
        className="font-mono text-[10px] tracking-widest uppercase
                   text-ark-border hover:text-ark-accent disabled:opacity-30 transition-colors"
      >
        {busy ? '// 上传中…' : atLimit ? '// 图片已满' : '// + 图片'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={onChange}
      />
      {err && (
        <span className="font-mono text-[10px] text-ark-danger tracking-widest">{'// ' + err}</span>
      )}
    </span>
  )
}
