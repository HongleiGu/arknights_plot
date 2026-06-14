'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  addCommentTo,
  deleteComment,
  editComment,
  isCurrentUserAdmin,
  listCommentsFor,
  modRemoveComment,
  reportComment,
  toggleReaction,
  type Anchor,
  type CommentRow,
} from '@/app/actions/comments'

// Curated reaction set — small + themed, no full emoji picker.
const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🤔']

interface Props {
  anchor: Anchor
  initialCount: number
}

// What the open reply box is aimed at: parentId is the thread root the new
// reply hangs under; replyToId is the specific comment being @-mentioned.
interface ReplyTarget {
  parentId: number
  replyToId: number
  toName: string | null
}

/**
 * Comment thread for a single anchor target (a node, an event option, …).
 * Renders a small `// N COMMENTS` indicator by default; clicking it loads
 * the comments lazily. Comments form a 2-level forum tree: first-level
 * comments are laid out directly, their replies collapse below them, and a
 * reply that @-mentions another comment shows that author + a button to jump
 * to the referenced comment.
 */
export default function CommentThread({ anchor, initialCount }: Props) {
  const [open,     setOpen]     = useState(false)
  const [loaded,   setLoaded]   = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [count,    setCount]    = useState(initialCount)
  const [body,     setBody]     = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [pending,  startTransition] = useTransition()

  // Threading UI state.
  const [expanded,    setExpanded]    = useState<Set<number>>(new Set()) // roots whose replies are shown
  const [replyTo,     setReplyTo]     = useState<ReplyTarget | null>(null)
  const [replyBody,   setReplyBody]   = useState('')
  const [replyError,  setReplyError]  = useState<string | null>(null)
  const [convoFor,    setConvoFor]    = useState<number | null>(null) // open conversation panel for this comment
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null) // permalink target

  async function toggle() {
    if (!open && !loaded) {
      const [rows, admin] = await Promise.all([listCommentsFor(anchor), isCurrentUserAdmin()])
      setComments(rows)
      setCount(rows.length)
      setIsAdmin(admin)
      setLoaded(true)
    }
    setOpen(o => !o)
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const text = body.trim()
    if (!text) return
    startTransition(async () => {
      const res = await addCommentTo(anchor, text)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setComments(prev => [...prev, res.comment])
      setCount(c => c + 1)
      setBody('')
    })
  }

  function submitReply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!replyTo) return
    setReplyError(null)
    const text = replyBody.trim()
    if (!text) return
    const target = replyTo
    startTransition(async () => {
      const res = await addCommentTo(anchor, text, {
        parentId:  target.parentId,
        replyToId: target.replyToId,
      })
      if (!res.ok) {
        setReplyError(res.error)
        return
      }
      setComments(prev => [...prev, res.comment])
      setCount(c => c + 1)
      setReplyBody('')
      setReplyTo(null)
      setExpanded(prev => new Set(prev).add(target.parentId)) // reveal the new reply
    })
  }

  function toggleExpand(rootId: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  function applyEdit(id: number, body: string, updated_at: string) {
    setComments(prev => prev.map(c => (c.id === id ? { ...c, body, updated_at } : c)))
  }

  function applyDelete(id: number, deleted_at: string) {
    // Keep the row (tombstone) so its replies stay visible; blank the body.
    setComments(prev => prev.map(c => (c.id === id ? { ...c, deleted_at, body: '' } : c)))
  }

  function applyModDelete(id: number, deleted_at: string, removed_by: number) {
    setComments(prev => prev.map(c => (c.id === id ? { ...c, deleted_at, removed_by, body: '' } : c)))
  }

  // Optimistically fold a toggled reaction into the comment's tallies.
  function applyReaction(id: number, emoji: string, reacted: boolean) {
    setComments(prev => prev.map(c => {
      if (c.id !== id) return c
      const tallies = c.reactions.filter(r => r.emoji !== emoji)
      const prevTally = c.reactions.find(r => r.emoji === emoji)
      const prevCount = prevTally?.count ?? 0
      const count = reacted ? prevCount + (prevTally?.mine ? 0 : 1) : Math.max(0, prevCount - 1)
      if (count > 0) tallies.push({ emoji, count, mine: reacted })
      tallies.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
      return { ...c, reactions: tallies }
    }))
  }

  // Close the conversation panel on Escape.
  useEffect(() => {
    if (convoFor == null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConvoFor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [convoFor])

  // Permalink (#cmt-<id>): if the hash targets a comment in THIS thread,
  // auto-open it, expand its root if it's a reply, and highlight it. Only
  // threads that actually have comments load, so it stays cheap.
  useEffect(() => {
    if (initialCount <= 0) return
    const m = window.location.hash.match(/^#cmt-(\d+)$/)
    if (!m) return
    const target = parseInt(m[1], 10)
    let cancelled = false
    void (async () => {
      const [rows, admin] = await Promise.all([listCommentsFor(anchor), isCurrentUserAdmin()])
      if (cancelled) return
      const hit = rows.find(r => r.id === target)
      if (!hit) return
      setComments(rows)
      setCount(rows.length)
      setIsAdmin(admin)
      setLoaded(true)
      setOpen(true)
      if (hit.parent_comment_id != null) setExpanded(prev => new Set(prev).add(hit.parent_comment_id!))
      setHighlightId(target)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll to + briefly ring the highlighted comment once it's rendered.
  useEffect(() => {
    if (highlightId == null) return
    const scroll = setTimeout(() => {
      document.getElementById(`cmt-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    const clear = setTimeout(() => setHighlightId(null), 2400)
    return () => { clearTimeout(scroll); clearTimeout(clear) }
  }, [highlightId])

  // Assemble the 2-level tree from the flat list.
  const roots = comments.filter(c => c.parent_comment_id == null)
  const repliesByRoot = new Map<number, CommentRow[]>()
  for (const c of comments) {
    if (c.parent_comment_id != null) {
      const arr = repliesByRoot.get(c.parent_comment_id) ?? []
      arr.push(c)
      repliesByRoot.set(c.parent_comment_id, arr)
    }
  }

  return (
    <div className="ml-12 mt-0.5 mb-1.5">
      <button
        type="button"
        onClick={toggle}
        className={`font-mono text-[10px] tracking-widest uppercase
                    ${count > 0 ? 'text-ark-accent' : 'text-ark-border'}
                    hover:text-ark-accent-bright transition-colors`}
        aria-expanded={open}
      >
        {'//'} {count.toString().padStart(2, '0')} COMMENT{count === 1 ? '' : 'S'} {open ? '−' : '+'}
      </button>

      {open && (
        <div className="mt-2 pl-3 border-l border-ark-border space-y-3">
          {loaded ? (
            <>
              {roots.length === 0 && (
                <p className="font-mono text-[10px] text-ark-border tracking-widest">
                  {'// no comments yet'}
                </p>
              )}

              {roots.map(root => {
                const replies = repliesByRoot.get(root.id) ?? []
                const isExpanded = expanded.has(root.id)
                return (
                  <div key={root.id} className="space-y-2">
                    <CommentItem
                      c={root}
                      isAdmin={isAdmin}
                      highlight={highlightId === root.id}
                      onReply={() => setReplyTo({ parentId: root.id, replyToId: root.id, toName: root.display_name })}
                      onEdited={(b, u) => applyEdit(root.id, b, u)}
                      onDeleted={d => applyDelete(root.id, d)}
                      onModRemoved={(d, by) => applyModDelete(root.id, d, by)}
                      onReact={(e, r) => applyReaction(root.id, e, r)}
                    />

                    {replyTo?.replyToId === root.id && (
                      <ReplyForm
                        toName={replyTo.toName}
                        body={replyBody}
                        setBody={setReplyBody}
                        onSubmit={submitReply}
                        onCancel={() => { setReplyTo(null); setReplyError(null) }}
                        error={replyError}
                        pending={pending}
                      />
                    )}

                    {replies.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(root.id)}
                        className="font-mono text-[10px] tracking-widest uppercase
                                   text-ark-muted hover:text-ark-accent transition-colors"
                      >
                        {'//'} {replies.length} {replies.length === 1 ? 'REPLY' : 'REPLIES'} {isExpanded ? '−' : '+'}
                      </button>
                    )}

                    {isExpanded && replies.length > 0 && (
                      <div className="ml-3 pl-3 border-l border-ark-border space-y-2">
                        {replies.map(r => (
                          <div key={r.id} className="space-y-2">
                            <CommentItem
                              c={r}
                              isAdmin={isAdmin}
                              highlight={highlightId === r.id}
                              onReply={() => setReplyTo({ parentId: root.id, replyToId: r.id, toName: r.display_name })}
                              onViewConvo={r.reply_to_comment_id != null && r.reply_to_comment_id !== root.id
                                ? () => setConvoFor(r.id) : undefined}
                              onEdited={(b, u) => applyEdit(r.id, b, u)}
                              onDeleted={d => applyDelete(r.id, d)}
                              onModRemoved={(d, by) => applyModDelete(r.id, d, by)}
                              onReact={(e, rc) => applyReaction(r.id, e, rc)}
                            />
                            {replyTo?.replyToId === r.id && (
                              <ReplyForm
                                toName={replyTo.toName}
                                body={replyBody}
                                setBody={setReplyBody}
                                onSubmit={submitReply}
                                onCancel={() => { setReplyTo(null); setReplyError(null) }}
                                error={replyError}
                                pending={pending}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <PostForm
                body={body}
                setBody={setBody}
                onSubmit={submit}
                error={error}
                pending={pending}
              />
            </>
          ) : (
            <p className="font-mono text-[10px] text-ark-muted tracking-widest">
              {'// loading...'}
            </p>
          )}
        </div>
      )}

      {convoFor != null && (
        <ConversationPanel
          targetId={convoFor}
          comments={comments}
          onClose={() => setConvoFor(null)}
        />
      )}
    </div>
  )
}


// `@username` prefix only when a reply targets ANOTHER reply (the deeper case
// where, in a flattened 2-level view, you'd otherwise lose track of who it's
// aimed at). A direct reply to a top-level comment sits right under its parent,
// so it needs no prefix — that's why we compare reply_to against parent.
function mentionName(c: CommentRow): string | null {
  return c.reply_to_comment_id != null && c.reply_to_comment_id !== c.parent_comment_id
    ? (c.reply_to_display_name ?? 'anon')
    : null
}

// Tombstone wording differs by who removed it (014): author vs moderator.
function tombstone(c: CommentRow): string {
  return c.removed_by != null ? '// [已被管理员移除]' : '// [已删除]'
}


function CommentItem({
  c, isAdmin, highlight, onReply, onViewConvo, onEdited, onDeleted, onModRemoved, onReact,
}: {
  c: CommentRow
  isAdmin?: boolean
  highlight?: boolean
  onReply?: () => void
  onViewConvo?: () => void
  onEdited?: (body: string, updated_at: string) => void
  onDeleted?: (deleted_at: string) => void
  onModRemoved?: (deleted_at: string, removed_by: number) => void
  onReact?: (emoji: string, reacted: boolean) => void
}) {
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState(c.body)
  const [err,      setErr]      = useState<string | null>(null)
  const [reported, setReported] = useState(false)
  const [picker,   setPicker]   = useState(false)
  const [busy,     startBusy]   = useTransition()

  const deleted = c.deleted_at != null
  const edited  = !deleted && c.updated_at !== c.created_at
  const mention = mentionName(c)
  const stamp = new Date(c.created_at).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

  // A soft-deleted comment keeps its slot (replies stay visible) but shows
  // only a tombstone — no author, no body, no actions.
  if (deleted) {
    return (
      <div id={`cmt-${c.id}`} className="text-sm">
        <p className="font-mono text-[10px] text-ark-border tracking-widest italic">
          {tombstone(c)}
        </p>
      </div>
    )
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    const text = draft.trim()
    if (!text) return
    startBusy(async () => {
      const res = await editComment(c.id, text)
      if (!res.ok) { setErr(res.error); return }
      onEdited?.(res.body, res.updated_at)
      setEditing(false)
    })
  }

  function remove() {
    if (!window.confirm('删除这条评论？此操作不可撤销。')) return
    setErr(null)
    startBusy(async () => {
      const res = await deleteComment(c.id)
      if (!res.ok) { setErr(res.error); return }
      onDeleted?.(res.deleted_at)
    })
  }

  function report() {
    const reason = window.prompt('举报理由（可选）：')
    if (reason === null) return // cancelled
    setErr(null)
    startBusy(async () => {
      const res = await reportComment(c.id, reason)
      if (!res.ok) { setErr(res.error); return }
      setReported(true)
    })
  }

  function modRemove() {
    if (!window.confirm('管理员移除这条评论？')) return
    setErr(null)
    startBusy(async () => {
      const res = await modRemoveComment(c.id)
      if (!res.ok) { setErr(res.error); return }
      onModRemoved?.(res.deleted_at, res.removed_by)
    })
  }

  function react(emoji: string) {
    setPicker(false)
    setErr(null)
    startBusy(async () => {
      const res = await toggleReaction(c.id, emoji)
      if (!res.ok) { setErr(res.error); return }
      onReact?.(emoji, res.reacted)
    })
  }

  const canManage = c.is_mine && (onEdited || onDeleted)
  // Others' live comments are reportable; admins can also remove them.
  const showReport = !c.is_mine
  const showModRemove = !!isAdmin && !c.is_mine

  return (
    <div
      id={`cmt-${c.id}`}
      className={`text-sm rounded-sm transition-colors
                  ${highlight ? 'ring-1 ring-ark-accent bg-ark-surface px-2 py-1 -mx-2' : ''}`}
    >
      <p className="font-mono text-[10px] text-ark-muted tracking-widest mb-0.5">
        <span className={c.is_mine ? 'text-ark-success' : 'text-ark-accent'}>
          {c.display_name ?? 'anon'}
        </span>
        <span className="text-ark-border"> · </span>
        <span>{stamp}</span>
        {edited && <span className="text-ark-border"> · 已编辑</span>}
      </p>

      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            maxLength={4000}
            autoFocus
            className="w-full bg-ark-surface border border-ark-border focus:border-ark-accent
                       outline-none px-3 py-2 text-sm text-ark-text
                       font-sans leading-relaxed resize-y transition-colors"
          />
          <div className="flex items-center gap-3">
            {err && (
              <span className="font-mono text-[10px] text-ark-danger tracking-widest">
                {'// ' + err.toUpperCase()}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(c.body); setErr(null) }}
              className="ml-auto font-mono text-[10px] tracking-widest uppercase
                         text-ark-border hover:text-ark-text transition-colors"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="font-mono text-[10px] tracking-widest uppercase
                         px-3 py-1 border border-ark-accent text-ark-accent
                         hover:bg-ark-accent hover:text-ark-bg
                         disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ark-accent
                         transition-colors"
            >
              {busy ? 'SAVING…' : 'SAVE →'}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-ark-text leading-relaxed whitespace-pre-wrap">
          {mention && <span className="text-ark-accent font-medium">@{mention} </span>}
          {c.body}
        </p>
      )}

      {!editing && onReact && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {c.reactions.map(r => (
            <button
              key={r.emoji}
              type="button"
              disabled={busy}
              onClick={() => react(r.emoji)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs transition-colors
                ${r.mine
                  ? 'border-ark-accent text-ark-accent bg-ark-accent/10'
                  : 'border-ark-border text-ark-muted hover:border-ark-accent-dim hover:text-ark-text'}
                disabled:opacity-40`}
            >
              <span>{r.emoji}</span>
              <span className="font-mono text-[10px]">{r.count}</span>
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPicker(o => !o)}
              aria-label="add reaction"
              className="px-1.5 py-0.5 rounded-full border border-ark-border text-ark-border
                         hover:text-ark-accent hover:border-ark-accent-dim text-xs leading-none
                         disabled:opacity-40 transition-colors"
            >
              ＋
            </button>
            {picker && (
              <div className="absolute left-0 top-full z-10 mt-1 flex gap-0.5 p-1
                              bg-ark-surface border border-ark-border rounded-sm shadow-lg">
                {REACTION_EMOJIS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => react(e)}
                    className="px-1.5 py-0.5 rounded hover:bg-ark-accent/10 text-base leading-none"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!editing && (onReply || onViewConvo || canManage || showReport || showModRemove) && (
        <div className="flex flex-wrap gap-4 mt-1">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="font-mono text-[10px] tracking-widest uppercase
                         text-ark-border hover:text-ark-accent transition-colors"
            >
              {'//'} REPLY
            </button>
          )}
          {onViewConvo && (
            <button
              type="button"
              onClick={onViewConvo}
              className="font-mono text-[10px] tracking-widest uppercase
                         text-ark-border hover:text-ark-accent transition-colors"
            >
              {'//'} 查看对话 ↗
            </button>
          )}
          {c.is_mine && onEdited && (
            <button
              type="button"
              onClick={() => { setDraft(c.body); setErr(null); setEditing(true) }}
              className="font-mono text-[10px] tracking-widest uppercase
                         text-ark-border hover:text-ark-accent transition-colors"
            >
              {'//'} EDIT
            </button>
          )}
          {c.is_mine && onDeleted && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="font-mono text-[10px] tracking-widest uppercase
                         text-ark-border hover:text-ark-danger transition-colors
                         disabled:opacity-30"
            >
              {'//'} DELETE
            </button>
          )}
          {showReport && (
            reported ? (
              <span className="font-mono text-[10px] tracking-widest uppercase text-ark-muted">
                {'//'} 已举报
              </span>
            ) : (
              <button
                type="button"
                onClick={report}
                disabled={busy}
                className="font-mono text-[10px] tracking-widest uppercase
                           text-ark-border hover:text-ark-danger transition-colors
                           disabled:opacity-30"
              >
                {'//'} REPORT
              </button>
            )
          )}
          {showModRemove && (
            <button
              type="button"
              onClick={modRemove}
              disabled={busy}
              className="font-mono text-[10px] tracking-widest uppercase
                         text-ark-danger/80 hover:text-ark-danger transition-colors
                         disabled:opacity-30"
            >
              {'//'} REMOVE ⚠
            </button>
          )}
          {err && (
            <span className="font-mono text-[10px] text-ark-danger tracking-widest">
              {'// ' + err.toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}


/**
 * Slide-in panel showing the whole conversation a comment belongs to, from the
 * first message. Rebuilt from the already-loaded `comments` (no fetch): the
 * thread = its root + all replies in chronological order. The reply→reply chain
 * ending at the clicked comment is emphasised; the target gets a ring.
 * Portalled to <body> so it escapes the nested scroll containers.
 */
function ConversationPanel({
  targetId, comments, onClose,
}: {
  targetId: number
  comments: CommentRow[]
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  const target = comments.find(c => c.id === targetId)
  if (!target) return null

  const rootId = target.parent_comment_id ?? target.id
  const root = comments.find(c => c.id === rootId) ?? null
  const replies = comments
    .filter(c => c.parent_comment_id === rootId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const thread = root ? [root, ...replies] : replies

  // The @-reply chain from the target back up to the root, for emphasis.
  const chain = new Set<number>()
  let cur: CommentRow | undefined = target
  while (cur) {
    chain.add(cur.id)
    const next: number | null = cur.reply_to_comment_id
    cur = next != null ? comments.find(c => c.id === next) : undefined
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <aside
        onClick={e => e.stopPropagation()}
        className="relative h-full w-full max-w-md bg-ark-bg border-l border-ark-border
                   shadow-2xl overflow-y-auto"
      >
        <header className="sticky top-0 z-10 bg-ark-bg/95 backdrop-blur border-b border-ark-border
                           px-5 py-3 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-widest uppercase text-ark-accent">
            {'//'} CONVERSATION · {thread.length.toString().padStart(2, '0')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] tracking-widest uppercase
                       text-ark-border hover:text-ark-text transition-colors"
          >
            CLOSE ✕
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {thread.map((c, i) => {
            const isTarget = c.id === targetId
            const inChain = chain.has(c.id)
            const mention = mentionName(c)
            const stamp = new Date(c.created_at).toLocaleString('zh-CN', {
              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            })
            return (
              <div
                key={c.id}
                className={`text-sm rounded-sm px-3 py-2 transition-colors
                  ${isTarget ? 'ring-1 ring-ark-accent bg-ark-surface'
                    : inChain ? 'bg-ark-surface/50' : ''}`}
              >
                <p className="font-mono text-[10px] text-ark-muted tracking-widest mb-1">
                  <span className="text-ark-border">{(i + 1).toString().padStart(2, '0')} </span>
                  <span className={c.is_mine ? 'text-ark-success' : 'text-ark-accent'}>
                    {c.display_name ?? 'anon'}
                  </span>
                  <span className="text-ark-border"> · </span>
                  <span>{stamp}</span>
                </p>
                {c.deleted_at != null ? (
                  <p className="font-mono text-[10px] text-ark-border tracking-widest italic">
                    {tombstone(c)}
                  </p>
                ) : (
                  <p className="text-ark-text leading-relaxed whitespace-pre-wrap">
                    {mention && <span className="text-ark-accent font-medium">@{mention} </span>}
                    {c.body}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>,
    document.body,
  )
}


function ReplyForm({
  toName, body, setBody, onSubmit, onCancel, error, pending,
}: {
  toName: string | null
  body: string
  setBody: (s: string) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  error: string | null
  pending: boolean
}) {
  if (error === 'not signed in') {
    return (
      <p className="font-mono text-[10px] text-ark-muted tracking-widest pl-3">
        <Link href="/auth" className="text-ark-accent hover:text-ark-accent-bright">
          [ LOG IN ]
        </Link>{' '}
        TO REPLY
      </p>
    )
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2 pl-3 border-l border-ark-accent/40">
      <p className="font-mono text-[10px] text-ark-muted tracking-widest">
        {'//'} REPLYING TO <span className="text-ark-accent">@{toName ?? 'anon'}</span>
      </p>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={2}
        maxLength={4000}
        autoFocus
        placeholder="// write a reply…"
        className="w-full bg-ark-surface border border-ark-border focus:border-ark-accent
                   outline-none px-3 py-2 text-sm text-ark-text
                   font-sans leading-relaxed resize-y transition-colors"
      />
      <div className="flex items-center gap-3">
        {error && error !== 'not signed in' && (
          <span className="font-mono text-[10px] text-ark-danger tracking-widest">
            {'// ' + error.toUpperCase()}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto font-mono text-[10px] tracking-widest uppercase
                     text-ark-border hover:text-ark-text transition-colors"
        >
          CANCEL
        </button>
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="font-mono text-[10px] tracking-widest uppercase
                     px-3 py-1 border border-ark-accent text-ark-accent
                     hover:bg-ark-accent hover:text-ark-bg
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ark-accent
                     transition-colors"
        >
          {pending ? 'POSTING…' : 'REPLY →'}
        </button>
      </div>
    </form>
  )
}


function PostForm({
  body, setBody, onSubmit, error, pending,
}: {
  body: string
  setBody: (s: string) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  error: string | null
  pending: boolean
}) {
  // If the server action returned "not signed in", surface a login prompt
  // instead of the form.
  if (error === 'not signed in') {
    return (
      <p className="font-mono text-[10px] text-ark-muted tracking-widest">
        <Link href="/auth" className="text-ark-accent hover:text-ark-accent-bright">
          [ LOG IN ]
        </Link>{' '}
        TO COMMENT
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 pt-1">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="// add a comment…"
        className="w-full bg-ark-surface border border-ark-border focus:border-ark-accent
                   outline-none px-3 py-2 text-sm text-ark-text
                   font-sans leading-relaxed resize-y transition-colors"
      />
      <div className="flex items-center justify-between">
        {error && error !== 'not signed in' && (
          <span className="font-mono text-[10px] text-ark-danger tracking-widest">
            {'// ' + error.toUpperCase()}
          </span>
        )}
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="ml-auto font-mono text-[10px] tracking-widest uppercase
                     px-3 py-1 border border-ark-accent text-ark-accent
                     hover:bg-ark-accent hover:text-ark-bg
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ark-accent
                     transition-colors"
        >
          {pending ? 'POSTING…' : 'POST →'}
        </button>
      </div>
    </form>
  )
}
