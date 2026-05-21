'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  addCommentTo,
  listCommentsFor,
  type Anchor,
  type CommentRow,
} from '@/app/actions/comments'

interface Props {
  anchor: Anchor
  initialCount: number
}

/**
 * Comment thread for a single anchor target (a node, an event option, …).
 * Renders a small `// N COMMENTS` indicator by default; clicking it loads
 * the comments lazily and exposes a post form when the user is signed in.
 */
export default function CommentThread({ anchor, initialCount }: Props) {
  const [open,     setOpen]     = useState(false)
  const [loaded,   setLoaded]   = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [count,    setCount]    = useState(initialCount)
  const [body,     setBody]     = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [pending,  startTransition] = useTransition()

  async function toggle() {
    if (!open && !loaded) {
      const rows = await listCommentsFor(anchor)
      setComments(rows)
      setCount(rows.length)
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
              {comments.length === 0 && (
                <p className="font-mono text-[10px] text-ark-border tracking-widest">
                  {'// no comments yet'}
                </p>
              )}
              {comments.map(c => (
                <CommentItem key={c.id} c={c} />
              ))}
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
    </div>
  )
}


function CommentItem({ c }: { c: CommentRow }) {
  const stamp = new Date(c.created_at).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="text-sm">
      <p className="font-mono text-[10px] text-ark-muted tracking-widest mb-0.5">
        <span className={c.is_mine ? 'text-ark-success' : 'text-ark-accent'}>
          {c.display_name ?? 'anon'}
        </span>
        <span className="text-ark-border"> · </span>
        <span>{stamp}</span>
      </p>
      <p className="text-ark-text leading-relaxed whitespace-pre-wrap">{c.body}</p>
    </div>
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
