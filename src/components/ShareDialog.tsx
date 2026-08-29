'use client'

// Google-Docs-style share modal, shared by clue boards (AP-12) and saved AI
// sessions (AP-20). Both back onto the same owner/editor/viewer model, so the
// dialog is generic over its data source: the caller passes the current
// visibility plus the four collaborator operations, and this component owns
// all of the interaction and chrome.

import { useEffect, useState } from 'react'

export type ShareVisibility = 'private' | 'unlisted' | 'public'

export interface ShareCollaborator {
  user_id: number
  display_name: string | null
  role: 'viewer' | 'editor'
}

export interface ShareDialogProps {
  /** Shown in the title bar — the board / session name. */
  name: string
  /** Path to copy as the share link, e.g. `/boards/12`. */
  linkPath: string
  visibility: ShareVisibility
  /** Per-visibility helper text; defaults suit a board. */
  hints?: Record<ShareVisibility, string>
  /** Label for the collaborators section, e.g. 「协作者」. */
  peopleLabel?: string
  setVisibility: (v: ShareVisibility) => Promise<unknown>
  load: () => Promise<ShareCollaborator[]>
  invite: (
    email: string, role: 'viewer' | 'editor',
  ) => Promise<{ ok: true; collaborator: ShareCollaborator } | { ok: false; error: string }>
  setRole: (userId: number, role: 'viewer' | 'editor') => Promise<unknown>
  remove: (userId: number) => Promise<unknown>
  onClose: () => void
}

const DEFAULT_HINTS: Record<ShareVisibility, string> = {
  private: '仅自己与被邀请的协作者',
  unlisted: '任何拿到链接的人可查看（不公开列出）',
  public: '任何人都能查看',
}

const VIS_ORDER: { value: ShareVisibility; label: string }[] = [
  { value: 'private', label: '私有' },
  { value: 'unlisted', label: '知道链接可看' },
  { value: 'public', label: '公开' },
]

export default function ShareDialog({
  name, linkPath, visibility: initialVisibility, hints, peopleLabel = '协作者',
  setVisibility, load, invite, setRole, remove, onClose,
}: ShareDialogProps) {
  const [visibility, setVis] = useState<ShareVisibility>(initialVisibility)
  const [collab, setCollab] = useState<ShareCollaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setInviteRole] = useState<'viewer' | 'editor'>('viewer')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    load().then(c => { if (live) { setCollab(c); setLoading(false) } })
    return () => { live = false }
    // `load` is defined inline by callers; re-running on identity change would
    // loop. The dialog is mounted per-subject, so loading once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function changeVisibility(v: ShareVisibility) {
    setVis(v)
    await setVisibility(v)
  }

  async function doInvite() {
    const e = email.trim()
    if (!e || busy) return
    setBusy(true); setMsg(null)
    const res = await invite(e, role)
    setBusy(false)
    if (!res.ok) { setMsg(res.error); return }
    setCollab(prev => [...prev.filter(c => c.user_id !== res.collaborator.user_id), res.collaborator])
    setEmail('')
  }

  async function changeRole(userId: number, r: 'viewer' | 'editor') {
    setCollab(prev => prev.map(c => (c.user_id === userId ? { ...c, role: r } : c)))
    await setRole(userId, r)
  }

  async function doRemove(userId: number) {
    setCollab(prev => prev.filter(c => c.user_id !== userId))
    await remove(userId)
  }

  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}${linkPath}`).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const hintFor = hints ?? DEFAULT_HINTS

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-[min(460px,100%)] max-h-[85vh] overflow-y-auto bg-ark-bg border border-ark-accent/40 shadow-2xl font-mono text-[12px]"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-ark-border bg-ark-surface/60">
          <span className="tracking-[0.2em] text-ark-accent uppercase">
            共享 <span className="text-ark-border">{'//'}</span>{' '}
            <span className="text-ark-muted normal-case font-sans">{name}</span>
          </span>
          <button onClick={onClose} className="text-ark-muted hover:text-ark-accent text-sm leading-none">×</button>
        </div>

        <div className="p-4 space-y-5">
          {/* visibility */}
          <section>
            <p className="text-ark-muted tracking-widest uppercase mb-2">{'//'} 可见性</p>
            <div className="space-y-1.5">
              {VIS_ORDER.map(o => (
                <label key={o.value} className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio" name="vis" checked={visibility === o.value}
                    onChange={() => changeVisibility(o.value)}
                    className="mt-0.5 accent-[color:var(--ark-accent)]"
                  />
                  <span>
                    <span className={visibility === o.value ? 'text-ark-accent' : 'text-ark-text group-hover:text-ark-accent'}>{o.label}</span>
                    <span className="block font-sans text-[11px] text-ark-muted">{hintFor[o.value]}</span>
                  </span>
                </label>
              ))}
            </div>
            {visibility !== 'private' && (
              <button
                onClick={copyLink}
                className="mt-2.5 tracking-widest uppercase px-2 py-1 border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim transition-colors"
              >
                {copied ? '已复制 ✓' : '复制链接'}
              </button>
            )}
          </section>

          {/* invite */}
          <section>
            <p className="text-ark-muted tracking-widest uppercase mb-2">{'//'} 邀请{peopleLabel}（按邮箱）</p>
            <div className="flex gap-2">
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doInvite() }}
                placeholder="someone@example.com"
                className="flex-1 bg-ark-surface border border-ark-border px-2 py-1.5 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
              />
              <select
                value={role} onChange={e => setInviteRole(e.target.value as 'viewer' | 'editor')}
                className="bg-ark-surface border border-ark-border px-1.5 text-ark-text outline-none focus:border-ark-accent-dim"
              >
                <option value="viewer">可查看</option>
                <option value="editor">可编辑</option>
              </select>
              <button
                onClick={doInvite} disabled={busy || !email.trim()}
                className="tracking-widest uppercase px-2.5 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ark-accent transition-colors"
              >
                邀请
              </button>
            </div>
            {msg && <p className="mt-1.5 text-ark-danger">{'// ' + msg}</p>}
          </section>

          {/* collaborators */}
          <section>
            <p className="text-ark-muted tracking-widest uppercase mb-2">
              {'//'} {peopleLabel} · {collab.length.toString().padStart(2, '0')}
            </p>
            {loading ? (
              <p className="text-ark-border">{'// 加载中…'}</p>
            ) : collab.length === 0 ? (
              <p className="text-ark-border">{`// 还没有${peopleLabel}`}</p>
            ) : (
              <ul className="space-y-1.5">
                {collab.map(c => (
                  <li key={c.user_id} className="flex items-center gap-2">
                    <span className="flex-1 font-sans text-ark-text truncate">
                      {c.display_name || `用户 #${c.user_id}`}
                    </span>
                    <select
                      value={c.role} onChange={e => changeRole(c.user_id, e.target.value as 'viewer' | 'editor')}
                      className="bg-ark-surface border border-ark-border px-1.5 py-0.5 text-ark-text outline-none focus:border-ark-accent-dim"
                    >
                      <option value="viewer">可查看</option>
                      <option value="editor">可编辑</option>
                    </select>
                    <button onClick={() => doRemove(c.user_id)} className="text-ark-muted hover:text-ark-danger px-1" title="移除">×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
