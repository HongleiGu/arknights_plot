'use client'

// Find a piece of canon by text and hand back its `@type/id` token (033).
//
// Was SearchAdd, which added the result as its own board node. Post-033 a
// citation isn't a node — it's a token inside a node's text — so this only
// resolves "the thing I mean" to a token and lets the caller place it.

import { useEffect, useRef, useState } from 'react'
import { searchEntities } from '@/app/actions/boards'
import type { ReferenceData } from '@/lib/references'

const TYPES: [string, string][] = [
  ['story', '剧情'], ['chapter', '章节'], ['node', '台词'], ['gadget', '藏品'],
  ['event', '事件'], ['option', '选项'], ['text', '文段'], ['furniture', '家具'],
  ['entity', '实体'],
]

export default function CiteSearch({ onPick }: { onPick: (token: string, ref: ReferenceData) => void }) {
  const [type, setType] = useState('node')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ReferenceData[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Debounced search. All state updates happen inside the timer (async), never
  // synchronously in the effect body.
  useEffect(() => {
    const query = q.trim()
    const t = setTimeout(async () => {
      if (!query) { setResults([]); setOpen(false); return }
      setBusy(true)
      const r = await searchEntities(query, type)
      setBusy(false)
      setResults(r)
      setOpen(true)
    }, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, type])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(ref: ReferenceData) {
    onPick(`@${ref.type}/${ref.id}`, ref)
    setQ('')
    setResults([])
    setOpen(false)
  }

  return (
    <div ref={box} className="relative flex items-center gap-1 nodrag">
      <select
        value={type}
        onChange={e => setType(e.target.value)}
        className="bg-ark-surface border border-ark-border focus:border-ark-accent outline-none
                   px-1 py-1 text-xs text-ark-text"
      >
        {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="搜索并引用…"
        className="flex-1 min-w-0 bg-ark-surface border border-ark-border focus:border-ark-accent outline-none
                   px-2 py-1 text-xs text-ark-text placeholder:text-ark-muted"
      />

      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-80 max-h-64 overflow-y-auto
                       bg-ark-bg border border-ark-border shadow-2xl">
          {busy && (
            <li className="px-3 py-2 font-mono text-[10px] text-ark-muted tracking-widest">{'// 搜索中…'}</li>
          )}
          {!busy && results.length === 0 && (
            <li className="px-3 py-2 font-mono text-[10px] text-ark-border tracking-widest">{'// 无结果'}</li>
          )}
          {results.map(r => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="block w-full text-left px-3 py-2 border-b border-ark-border/60
                           hover:bg-ark-surface transition-colors"
              >
                <span className="text-sm text-ark-text">{r.label}</span>
                <span className="ml-1.5 font-mono text-[10px] text-ark-border">{r.type}/{r.id}</span>
                {r.preview && (
                  <span className="block text-xs text-ark-muted line-clamp-1 mt-0.5">{r.preview}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
