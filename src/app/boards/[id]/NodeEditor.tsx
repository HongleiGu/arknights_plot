'use client'

// Editor panel for a single board node (033): title, body, citations, image.
//
// Replaces the old window.prompt card editor. Nodes are the whole content model
// now, so they need somewhere real to be written — and citation insertion has
// to be one click, or nobody will ground anything.

import { useEffect, useRef, useState } from 'react'
import CiteSearch from './CiteSearch'
import { updateMember, type BoardMember } from '@/app/actions/boards'
import { uploadBoardImageAction } from '@/app/actions/media'
import { downscaleImage } from '@/lib/downscale'

export default function NodeEditor({
  member, onPatch, onDelete, onClose,
}: {
  member: BoardMember
  onPatch: (patch: Partial<BoardMember>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(member.title ?? '')
  const [body, setBody] = useState(member.body)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Debounced autosave. The action returns freshly resolved refs whenever the
  // text changed, so the card's chips and its grounded/ungrounded styling
  // follow along without a reload.
  useEffect(() => {
    if (title === (member.title ?? '') && body === member.body) return
    const t = setTimeout(async () => {
      setBusy('saving')
      const res = await updateMember(member.id, { title: title.trim() || null, body })
      setBusy(null)
      if (!res.ok) { setErr('保存失败'); return }
      setErr(null)
      onPatch({ title: title.trim() || null, body, ...(res.refs ? { refs: res.refs } : {}) })
    }, 600)
    return () => clearTimeout(t)
    // onPatch is recreated per render by the parent; depending on it would
    // restart the timer on every keystroke's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, member.id])

  /** Insert a citation token at the caret (or append when unfocused). */
  function insertCite(token: string) {
    const el = bodyRef.current
    if (!el) { setBody(b => (b ? `${b} ${token}` : token)); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    // Keep it readable: pad with a space unless we're already on one.
    const before = body.slice(0, start)
    const after = body.slice(end)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${lead}${token}${after}`
    setBody(next)
    // Restore the caret after React re-renders the textarea.
    requestAnimationFrame(() => {
      const pos = (before + lead + token).length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  async function pickImage(file: File) {
    setErr(null)
    setBusy('image')
    try {
      // Shrink client-side first: a phone photo would otherwise bounce off the
      // 2MB server cap, and a card never renders larger than ~600px anyway.
      const shrunk = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', shrunk.file)
      const res = await uploadBoardImageAction(fd)
      if (!res.ok) { setErr(res.error); return }
      await updateMember(member.id, { imageUrl: res.url, imageW: shrunk.width, imageH: shrunk.height })
      onPatch({ image_url: res.url, image_w: shrunk.width, image_h: shrunk.height })
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function clearImage() {
    await updateMember(member.id, { imageUrl: null, imageW: null, imageH: null })
    onPatch({ image_url: null, image_w: null, image_h: null })
  }

  return (
    <div className="w-80 bg-ark-bg border border-ark-accent/40 shadow-2xl font-mono text-[11px] nodrag">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-ark-border bg-ark-surface/60">
        <span className="tracking-widest uppercase text-ark-accent">
          节点 <span className="text-ark-border">#{member.id}</span>
        </span>
        <div className="flex items-center gap-2">
          {busy === 'saving' && <span className="text-ark-border tracking-widest">保存中</span>}
          <button onClick={onClose} className="text-ark-muted hover:text-ark-accent text-sm leading-none">×</button>
        </div>
      </div>

      <div className="p-2.5 space-y-2.5">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="标题（可选）"
          className="w-full bg-ark-surface border border-ark-border px-2 py-1 text-ark-text
                     placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
        />

        <textarea
          ref={bodyRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          placeholder="你的推断…　用下面的搜索插入 @引用 作为依据"
          className="w-full resize-y bg-ark-surface border border-ark-border px-2 py-1 text-ark-text
                     placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans leading-relaxed"
        />

        {/* citation insert */}
        <div>
          <p className="text-ark-muted tracking-widest uppercase mb-1">{'//'} 插入引用</p>
          <CiteSearch onPick={token => insertCite(token)} />
          <p className="text-ark-border tracking-widest mt-1">
            {'//'} {member.refs.length > 0
              ? `已引用 ${member.refs.length} 处`
              : '尚无引用——该节点目前只是推测'}
          </p>
        </div>

        {/* image */}
        <div>
          <p className="text-ark-muted tracking-widest uppercase mb-1">{'//'} 配图</p>
          {member.image_url ? (
            <div className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={member.image_url} alt="" className="w-full max-h-28 object-cover border border-ark-border" />
              <button onClick={clearImage} className="tracking-widest uppercase text-ark-muted hover:text-ark-danger">
                移除配图
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy === 'image'}
              className="px-2 py-1 border border-ark-border text-ark-muted hover:text-ark-accent
                         hover:border-ark-accent-dim disabled:opacity-40 tracking-widest uppercase transition-colors"
            >
              {busy === 'image' ? '上传中…' : '上传图片'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) void pickImage(f) }}
          />
        </div>

        {err && <p className="text-ark-danger">{'// ' + err}</p>}

        <div className="pt-1 border-t border-ark-border/60">
          <button onClick={onDelete} className="tracking-widest uppercase text-ark-muted hover:text-ark-danger">
            删除节点
          </button>
        </div>
      </div>
    </div>
  )
}
