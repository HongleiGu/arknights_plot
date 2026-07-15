'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBoard } from '@/app/actions/boards'

export default function CreateBoard() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setErr(null)
    const res = await createBoard(title)
    setBusy(false)
    if (!res.ok) { setErr(res.error === 'not signed in' ? '请先登录' : res.error); return }
    router.push(`/boards/${res.id}`)
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="// 新线索板标题…"
        className="flex-1 bg-ark-surface border border-ark-border focus:border-ark-accent
                   outline-none px-3 py-2 text-sm text-ark-text placeholder:text-ark-muted transition-colors"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="font-mono text-[10px] tracking-widest uppercase px-3 py-2
                   border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg
                   disabled:opacity-30 transition-colors"
      >
        {busy ? '…' : '+ 新建'}
      </button>
      {err && <span className="font-mono text-[10px] text-ark-danger tracking-widest">{err}</span>}
    </form>
  )
}
