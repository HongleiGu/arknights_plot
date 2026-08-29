'use client'

// The assistant's client-side streaming loop, shared by the floating panel
// (Assistant.tsx) and a saved session's continue box (/ai/[id], AP-20).
//
// Owns the transcript state, the NDJSON reader over /api/assistant, and the
// scratchpad carried across a truncated run so 「继续」 resumes with context.

import { useEffect, useRef, useState } from 'react'
import type { Part, TextPart, Turn, Usage } from '@/components/AiTranscript'

type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; summary: string }
  | { type: 'done'; usage?: Usage; truncated?: boolean; scratchpad?: string[] }
  | { type: 'error'; message: string }

export function useAssistantStream(initialTurns: Turn[] = []) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const notesRef = useRef<string[]>([])

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Mutate the last (streaming) assistant turn immutably. */
  function patchLast(fn: (t: Extract<Turn, { role: 'assistant' }>) => Extract<Turn, { role: 'assistant' }>) {
    setTurns(prev => {
      const next = prev.slice()
      const last = next[next.length - 1]
      if (last?.role === 'assistant') next[next.length - 1] = fn(last)
      return next
    })
  }

  function apply(ev: StreamEvent) {
    if (ev.type === 'text') {
      patchLast(t => {
        const parts = t.parts.slice()
        const tail = parts[parts.length - 1]
        if (tail?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: tail.text + ev.delta }
        else parts.push({ kind: 'text', text: ev.delta })
        return { ...t, parts }
      })
    } else if (ev.type === 'tool_call') {
      patchLast(t => ({ ...t, parts: [...t.parts, { kind: 'tool', name: ev.name, args: ev.args, status: 'running' }] }))
    } else if (ev.type === 'tool_result') {
      patchLast(t => {
        const parts: Part[] = t.parts.slice()
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]
          if (p.kind === 'tool' && p.status === 'running') {
            parts[i] = { ...p, status: 'done', summary: ev.summary }
            break
          }
        }
        return { ...t, parts }
      })
    } else if (ev.type === 'done') {
      notesRef.current = ev.scratchpad ?? []
      patchLast(t => ({ ...t, usage: ev.usage ?? t.usage, truncated: !!ev.truncated }))
    } else if (ev.type === 'error') {
      patchLast(t => ({ ...t, error: ev.message }))
    }
  }

  /**
   * Ask a question and stream the answer in. `boardId` anchors the run to a
   * board's context (AP-20); the route still reads that board under the
   * caller's own RLS, so this grants no extra access.
   */
  async function send(text: string, opts: { boardId?: number | null } = {}) {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)

    // History for the model (strip the trace; only the final text of each turn).
    const history = turns.map(t =>
      t.role === 'user'
        ? { role: 'user' as const, content: t.text }
        : { role: 'assistant' as const, content: t.parts.filter(p => p.kind === 'text').map(p => (p as TextPart).text).join('') },
    ).filter(m => m.content.trim())

    setTurns(prev => [
      ...prev,
      { role: 'user', text: q },
      { role: 'assistant', parts: [], streaming: true },
    ])

    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: q }],
          scratchpad: notesRef.current,
          boardId: opts.boardId ?? null,
        }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '')
        // Budget (402) / auth (401) come back as a short message or JSON.
        let msg = raw
        try { const j = JSON.parse(raw); if (j?.message) msg = j.message } catch { /* plain text */ }
        if (res.status === 401) msg = msg || '请先登录后再使用 AI 助手'
        patchLast(t => ({ ...t, error: msg || `请求失败（${res.status}）` }))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) apply(JSON.parse(line) as StreamEvent)
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        patchLast(t => ({ ...t, error: e instanceof Error ? e.message : String(e) }))
      }
    } finally {
      patchLast(t => ({ ...t, streaming: false }))
      setBusy(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function reset() {
    setTurns([])
    notesRef.current = []
  }

  return { turns, setTurns, busy, send, stop, reset }
}
