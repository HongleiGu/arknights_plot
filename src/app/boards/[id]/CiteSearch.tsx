'use client'

// Find a piece of canon by text and hand back its `@type/id` token (033).
//
// Was SearchAdd, which added the result as its own board node. Post-033 a
// citation isn't a node — it's a token inside a node's text — so this only
// resolves "the thing I mean" to a token and lets the caller place it.
//
// Dialogue gets a scope row (story → chapter → speaker). `nodes` is by far the
// biggest table, and a bare substring search over every line in the game is
// useless in a picker: searching "我知道" unscoped is noise. Narrowing first is
// what makes citing a specific line practical — and if citing is impractical,
// nobody grounds anything and the whole model falls over.

import { useEffect, useRef, useState } from 'react'
import {
  listChapters,
  listSpeakers,
  searchEntities,
  type ChapterOption,
  type SpeakerOption,
} from '@/app/actions/boards'
import type { ReferenceData } from '@/lib/references'

const TYPES: [string, string][] = [
  ['node', '台词'], ['story', '剧情'], ['chapter', '章节'], ['gadget', '藏品'],
  ['event', '事件'], ['option', '选项'], ['text', '文段'], ['furniture', '家具'],
  ['entity', '实体'],
]

// Types whose rows live under a story, so scoping by story/chapter helps.
const SCOPED = new Set(['node', 'chapter'])

const inputCls =
  'w-full bg-ark-surface border border-ark-border focus:border-ark-accent outline-none ' +
  'px-2 py-1 text-xs text-ark-text placeholder:text-ark-muted'

export default function CiteSearch({ onPick }: { onPick: (token: string, ref: ReferenceData) => void }) {
  const [type, setType] = useState('node')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ReferenceData[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Scope
  const [story, setStory] = useState<{ id: number; label: string } | null>(null)
  const [storyQ, setStoryQ] = useState('')
  const [storyHits, setStoryHits] = useState<ReferenceData[]>([])
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [speakers, setSpeakers] = useState<SpeakerOption[]>([])
  const [speaker, setSpeaker] = useState<string>('')

  const scoped = SCOPED.has(type)

  // Narrowing the scope resets everything below it. Done in the handlers rather
  // than an effect: it's a consequence of the click, not of the render.
  function chooseStory(next: { id: number; label: string } | null) {
    setStory(next)
    setStoryQ('')
    setChapterId(null)
    setSpeaker('')
  }
  function chooseType(next: string) {
    setType(next)
    chooseStory(null)
  }

  // Stale lists are hidden by derivation rather than cleared by an effect, so
  // no effect below ever calls setState synchronously (cascading renders).
  const showChapters = scoped && type === 'node' && !!story
  const showSpeakers = type === 'node' && (!!story || chapterId != null)

  // Story lookup for the scope row (debounced, same shape as the main search).
  useEffect(() => {
    const query = storyQ.trim()
    const t = setTimeout(async () => {
      setStoryHits(query && !story ? await searchEntities(query, 'story') : [])
    }, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [storyQ, story])

  // Chapters of the chosen story.
  useEffect(() => {
    if (!story || type !== 'node') return
    let live = true
    listChapters(story.id).then(cs => { if (live) setChapters(cs) })
    return () => { live = false }
  }, [story, type])

  // Speakers present in the current scope, most talkative first.
  useEffect(() => {
    if (type !== 'node' || (!story && chapterId == null)) return
    let live = true
    listSpeakers({ storyId: story?.id, chapterId: chapterId ?? undefined })
      .then(ss => { if (live) setSpeakers(ss) })
    return () => { live = false }
  }, [story, chapterId, type])

  // Main search. With a scope set, an empty query is meaningful ("every line
  // 凯尔希 says in this chapter"), so it runs on filter changes too.
  useEffect(() => {
    const query = q.trim()
    const hasFilter = !!story || chapterId != null || !!speaker
    const t = setTimeout(async () => {
      if (!query && !hasFilter) { setResults([]); setOpen(false); return }
      setBusy(true)
      const r = await searchEntities(query, type, {
        storyId: story?.id,
        chapterId: chapterId ?? undefined,
        speaker: speaker || undefined,
      })
      setBusy(false)
      setResults(r)
      setOpen(true)
    }, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, type, story, chapterId, speaker])

  // Close the results list on outside click.
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
    <div ref={box} className="relative space-y-1 nodrag">
      <select value={type} onChange={e => chooseType(e.target.value)} className={inputCls}>
        {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>

      {scoped && (
        <>
          {/* story */}
          {story ? (
            <div className="flex items-center gap-1 px-2 py-1 border border-ark-accent-dim bg-ark-accent/5 text-xs">
              <span className="flex-1 truncate text-ark-accent">{story.label}</span>
              <button
                onClick={() => chooseStory(null)}
                className="text-ark-muted hover:text-ark-danger leading-none"
                title="清除剧情范围"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={storyQ}
                onChange={e => setStoryQ(e.target.value)}
                placeholder="限定剧情（可选）…"
                className={inputCls}
              />
              {storyHits.length > 0 && (
                <ul className="absolute left-0 top-full z-[60] mt-1 w-full max-h-40 overflow-y-auto
                               bg-ark-bg border border-ark-border shadow-2xl">
                  {storyHits.map(s => (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => chooseStory({ id: s.id, label: s.label })}
                        className="block w-full text-left px-2 py-1.5 text-xs text-ark-text
                                   border-b border-ark-border/60 hover:bg-ark-surface transition-colors"
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* chapter */}
          {showChapters && chapters.length > 0 && (
            <select
              value={chapterId ?? ''}
              onChange={e => {
                setChapterId(e.target.value ? Number(e.target.value) : null)
                // The speaker list is scoped to the chapter, so a held-over
                // pick could name someone with no lines here — which would
                // silently return nothing while the dropdown showed blank.
                setSpeaker('')
              }}
              className={inputCls}
            >
              <option value="">全部章节</option>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}

          {/* speaker */}
          {showSpeakers && speakers.length > 0 && (
            <select value={speaker} onChange={e => setSpeaker(e.target.value)} className={inputCls}>
              <option value="">全部说话人</option>
              {speakers.map(s => (
                <option key={s.name} value={s.name}>{s.name}（{s.lines}）</option>
              ))}
            </select>
          )}
        </>
      )}

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={scoped && (story || speaker) ? '搜索台词（留空=全部）…' : '搜索并引用…'}
        className={inputCls}
      />

      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-full max-h-64 overflow-y-auto
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
                  <span className="block text-xs text-ark-muted line-clamp-2 mt-0.5">{r.preview}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
