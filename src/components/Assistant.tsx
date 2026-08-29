'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import ShareDialog from '@/components/ShareDialog'
import { TurnView, toTurnInputs } from '@/components/AiTranscript'
import { useAssistantStream } from '@/components/useAssistantStream'
import {
  createConversation,
  appendTurns,
  updateConversation,
  listConversationCollaborators,
  inviteConversationCollaborator,
  updateConversationCollaboratorRole,
  removeConversationCollaborator,
  type ConversationVisibility,
} from '@/app/actions/conversations'

// Visibility copy for a saved session — a transcript, not a board.
const SESSION_HINTS: Record<ConversationVisibility, string> = {
  private: '仅自己与被邀请的协作者',
  unlisted: '任何拿到链接的人可查看（不公开列出）',
  public: '任何人都能查看这次问答',
}

export default function Assistant() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const { turns, busy, send, stop, reset } = useAssistantStream()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Saved-session state (AP-20). `savedCount` is how many turns are already
  // persisted, so a second save appends only what's new.
  const [convoId, setConvoId] = useState<number | null>(null)
  const [convoTitle, setConvoTitle] = useState('')
  const [convoVis, setConvoVis] = useState<ConversationVisibility>('private')
  const [savedCount, setSavedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  // Keep the transcript pinned to the bottom as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns, open])

  function submit() {
    const text = input.trim()
    if (!text) return
    setInput('')
    send(text)
  }

  /** Save the transcript — creating the session, or appending new turns to it. */
  async function save() {
    if (saving || busy || turns.length === 0) return
    setSaving(true); setSaveError(null)
    try {
      if (convoId == null) {
        const res = await createConversation(toTurnInputs(turns))
        if (!res.ok) { setSaveError(res.error); return }
        setConvoId(res.id)
        const first = turns.find(t => t.role === 'user')
        setConvoTitle(first?.role === 'user' ? first.text.slice(0, 60) : '未命名会话')
        setSavedCount(turns.length)
      } else {
        const fresh = turns.slice(savedCount)
        if (fresh.length === 0) return
        const res = await appendTurns(convoId, toTurnInputs(fresh))
        if (!res.ok) { setSaveError(res.error ?? '保存失败'); return }
        setSavedCount(turns.length)
      }
    } finally {
      setSaving(false)
    }
  }

  /** Clearing starts a brand-new session rather than appending to the old one. */
  function clearAll() {
    reset()
    setConvoId(null)
    setSavedCount(0)
    setSaveError(null)
    setConvoVis('private')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const unsaved = turns.length - savedCount

  return (
    <>
      {/* Launcher — labeled pill in the lower-right corner. Hidden while the panel is open. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="打开 AI 分析终端"
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 pl-3 pr-3.5 py-2.5
                     bg-ark-bg/95 backdrop-blur-sm border border-ark-accent/60 text-ark-accent
                     font-mono text-[11px] tracking-[0.2em] uppercase
                     hover:bg-ark-accent hover:text-ark-bg transition-colors
                     shadow-2xl shadow-ark-accent/10"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% 65%, 90% 100%, 0 100%)' }}
        >
          <span className="text-base leading-none">⌘</span>
          <span>AI 分析</span>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-6 right-6 z-[60] w-[min(440px,calc(100vw-3rem))] h-[min(70vh,640px)]
                     flex flex-col bg-ark-bg border border-ark-accent/40
                     shadow-2xl shadow-ark-accent/10 font-mono text-[12px]"
        >
          {/* Title bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-ark-border bg-ark-surface/60">
            <span className="tracking-[0.2em] text-ark-accent uppercase">
              ARK-INTEL <span className="text-ark-border">{'//'}</span>{' '}
              <span className="text-ark-muted normal-case font-sans">剧情分析终端</span>
            </span>
            <div className="flex items-center gap-2 text-ark-muted">
              {turns.length > 0 && (
                <button
                  onClick={save}
                  disabled={busy || saving || (convoId != null && unsaved === 0)}
                  className="hover:text-ark-accent disabled:opacity-40 disabled:hover:text-ark-muted uppercase tracking-widest text-[10px]"
                  title="保存这次问答，便于分享 / 稍后继续"
                >
                  {saving ? '保存中' : convoId == null ? '保存' : unsaved > 0 ? `保存 +${unsaved}` : '已保存'}
                </button>
              )}
              {convoId != null && (
                <button
                  onClick={() => setSharing(true)}
                  className="hover:text-ark-accent uppercase tracking-widest text-[10px]"
                  title="共享这次问答"
                >
                  共享
                </button>
              )}
              {turns.length > 0 && (
                <button onClick={clearAll} className="hover:text-ark-accent uppercase tracking-widest text-[10px]" disabled={busy}>
                  清空
                </button>
              )}
              <button onClick={() => setOpen(false)} className="hover:text-ark-accent text-sm leading-none">×</button>
            </div>
          </div>

          {/* Saved-session strip */}
          {(convoId != null || saveError) && (
            <div className="px-3 py-1 border-b border-ark-border/60 text-[10px] tracking-widest">
              {saveError ? (
                <span className="text-ark-danger">{'// '}{saveError}</span>
              ) : (
                <span className="text-ark-border">
                  {'//'} 已保存为会话{' '}
                  <Link href={`/ai/${convoId}`} className="text-ark-accent hover:underline">#{convoId}</Link>
                  {unsaved > 0 && <span className="text-ark-muted"> · {unsaved} 条未保存</span>}
                </span>
              )}
            </div>
          )}

          {/* Transcript */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 leading-relaxed">
            {turns.length === 0 && (
              <div className="text-ark-muted space-y-1">
                <p className="text-ark-accent">{'>'} 明日方舟剧情分析终端 · 已就绪</p>
                <p>{'//'} 检索并阅读规范剧情数据与线索板后作答。</p>
                <p>{'//'} 例：「多萝西和它的机器之间是什么关系？」</p>
              </div>
            )}

            {turns.map((t, i) => (
              <TurnView
                key={i}
                turn={t}
                busy={busy}
                onContinue={() => send('继续：接着上面的调查，把没查完的部分补齐并给出最终结论。')}
              />
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-ark-border p-2 flex items-end gap-2">
            <span className="text-ark-accent pb-2">{'>'}</span>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="询问剧情… (Enter 发送 · Shift+Enter 换行)"
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
        </div>
      )}

      {sharing && convoId != null && (
        <ShareDialog
          name={convoTitle || `会话 #${convoId}`}
          linkPath={`/ai/${convoId}`}
          visibility={convoVis}
          hints={SESSION_HINTS}
          setVisibility={async v => {
            setConvoVis(v as ConversationVisibility)
            await updateConversation(convoId, { visibility: v as ConversationVisibility })
          }}
          load={() => listConversationCollaborators(convoId)}
          invite={(email, role) => inviteConversationCollaborator(convoId, email, role)}
          setRole={(userId, role) => updateConversationCollaboratorRole(convoId, userId, role)}
          remove={userId => removeConversationCollaborator(convoId, userId)}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  )
}
