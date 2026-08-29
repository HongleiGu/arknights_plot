'use client'

// A saved AI session (AP-20). Replays the stored transcript — tool trace and
// all — and, for the owner or an 'editor' collaborator, lets the conversation
// be continued in place. New turns are appended to the shared transcript, so
// collaborators see each other's follow-ups on reload.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ShareDialog from '@/components/ShareDialog'
import { TurnView, partsFromJson, toTurnInputs, type Turn, type Usage } from '@/components/AiTranscript'
import { useAssistantStream } from '@/components/useAssistantStream'
import {
  appendTurns,
  updateConversation,
  deleteConversation,
  listConversationCollaborators,
  inviteConversationCollaborator,
  updateConversationCollaboratorRole,
  removeConversationCollaborator,
  type Conversation,
  type ConversationVisibility,
} from '@/app/actions/conversations'

const SESSION_HINTS: Record<ConversationVisibility, string> = {
  private: '仅自己与被邀请的协作者',
  unlisted: '任何拿到链接的人可查看（不公开列出）',
  public: '任何人都能查看这次问答',
}

const VIS_LABEL: Record<string, string> = {
  private: '私有', unlisted: '链接可见', public: '公开',
}

/** Persisted rows → the shared transcript model. */
function toTurns(convo: Conversation): Turn[] {
  return convo.turns.map(t =>
    t.role === 'user'
      ? { role: 'user' as const, text: t.content, author: t.author_name }
      : {
          role: 'assistant' as const,
          parts: partsFromJson(t.parts, t.content),
          streaming: false,
          usage: (t.usage as Usage | null) ?? undefined,
        },
  )
}

export default function SessionView({ convo }: { convo: Conversation }) {
  const router = useRouter()
  const initial = toTurns(convo)
  const { turns, busy, send, stop } = useAssistantStream(initial)

  const [input, setInput] = useState('')
  const [title, setTitle] = useState(convo.title)
  const [visibility, setVisibility] = useState<ConversationVisibility>(convo.visibility)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // How many turns are already in the database. Everything past this is new
  // and gets appended once the stream finishes.
  const savedCount = useRef(initial.length)
  const flushing = useRef(false)

  useEffect(() => {
    if (busy || flushing.current) return
    const fresh = turns.slice(savedCount.current)
    if (fresh.length === 0) return
    // Don't persist a half-finished turn (aborted mid-stream).
    if (fresh.some(t => t.role === 'assistant' && t.streaming)) return

    flushing.current = true
    const count = turns.length
    appendTurns(convo.id, toTurnInputs(fresh))
      .then(res => {
        if (res.ok) savedCount.current = count
        else setError(res.error ?? '保存失败')
      })
      .finally(() => { flushing.current = false })
  }, [busy, turns, convo.id])

  function submit() {
    const text = input.trim()
    if (!text) return
    setInput('')
    setError(null)
    send(text, { boardId: convo.board_id })
  }

  async function rename() {
    const next = title.trim()
    if (!next || next === convo.title) return
    await updateConversation(convo.id, { title: next })
    router.refresh()
  }

  async function remove() {
    if (!confirm('删除这个会话？此操作不可撤销。')) return
    const res = await deleteConversation(convo.id)
    if (res.ok) router.push('/ai')
    else setError('删除失败')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />

      {/* header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        {convo.is_owner ? (
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={rename}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="flex-1 bg-transparent text-2xl font-light tracking-widest text-ark-text
                       border-b border-transparent hover:border-ark-border focus:border-ark-accent-dim
                       outline-none transition-colors"
          />
        ) : (
          <h1 className="flex-1 text-2xl font-light tracking-widest text-ark-text">{title}</h1>
        )}
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase pt-2">
          {convo.is_owner && (
            <>
              <button onClick={() => setSharing(true)} className="text-ark-muted hover:text-ark-accent">共享</button>
              <button onClick={remove} className="text-ark-muted hover:text-ark-danger">删除</button>
            </>
          )}
          <Link href="/ai" className="text-ark-muted hover:text-ark-accent">{'// 全部'}</Link>
        </div>
      </div>

      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// AI SESSION · '}{convo.turns.length.toString().padStart(2, '0')}
        {convo.is_owner
          ? <span> · {VIS_LABEL[visibility] ?? visibility}</span>
          : <span className="text-ark-accent"> · {convo.can_edit ? '可继续提问' : '只读'}</span>}
        {convo.board_id != null && (
          <>
            {' · '}
            <Link href={`/boards/${convo.board_id}`} className="text-ark-accent hover:underline normal-case">
              线索板 {convo.board_title ?? `#${convo.board_id}`}
            </Link>
          </>
        )}
      </p>

      {/* transcript */}
      <div className="font-mono text-[12px] space-y-3 leading-relaxed border border-ark-border p-4">
        {turns.length === 0 && (
          <p className="text-ark-border tracking-widest">{'// 这个会话还没有内容'}</p>
        )}
        {turns.map((t, i) => <TurnView key={i} turn={t} busy={busy} />)}
      </div>

      {error && <p className="mt-2 font-mono text-[11px] text-ark-danger">{'// '}{error}</p>}

      {/* continue box — owner or editor only */}
      {convo.can_edit ? (
        <div className="mt-4 border border-ark-border p-2 flex items-end gap-2 font-mono text-[12px]">
          <span className="text-ark-accent pb-2">{'>'}</span>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={1}
            placeholder="继续追问… (Enter 发送 · Shift+Enter 换行)"
            className="flex-1 resize-none bg-transparent text-ark-text placeholder:text-ark-muted/60
                       outline-none max-h-28 leading-relaxed"
          />
          {busy ? (
            <button onClick={stop} className="text-ark-muted hover:text-red-400 uppercase tracking-widest text-[10px] pb-1">
              停止
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="text-ark-accent hover:text-ark-accent-bright disabled:text-ark-muted/40 uppercase tracking-widest text-[10px] pb-1"
            >
              发送
            </button>
          )}
        </div>
      ) : (
        <p className="mt-4 font-mono text-[10px] text-ark-border tracking-widest uppercase">
          {'//'} 只读——需要「可编辑」权限才能继续提问
        </p>
      )}

      {sharing && (
        <ShareDialog
          name={title || `会话 #${convo.id}`}
          linkPath={`/ai/${convo.id}`}
          visibility={visibility}
          hints={SESSION_HINTS}
          setVisibility={async v => {
            setVisibility(v as ConversationVisibility)
            await updateConversation(convo.id, { visibility: v as ConversationVisibility })
          }}
          load={() => listConversationCollaborators(convo.id)}
          invite={(email, role) => inviteConversationCollaborator(convo.id, email, role)}
          setRole={(userId, role) => updateConversationCollaboratorRole(convo.id, userId, role)}
          remove={userId => removeConversationCollaborator(convo.id, userId)}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  )
}
