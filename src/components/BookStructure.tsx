'use client'

// Structural editor for 大地巡旅 (AP-31) — see actions/bookStructure.ts for why
// this exists rather than a SQL session.
//
// The layout is the whole book at once, because every problem it exists to fix
// is a problem BETWEEN chapters: a page in the wrong one, a page in two of
// them, a chapter left empty by a move. A per-chapter form would hide exactly
// the relationships you are trying to see.

import { useEffect, useState } from 'react'
import {
  getBookStructure, renameChapter, deleteChapter, movePage, dropDuplicatePage,
  type StructureReport, type ChapterInfo,
} from '@/app/actions/bookStructure'

/** "417-426" / "428-430, 453" — the shape of a chapter at a glance. */
function spanOf(pages: number[]): string {
  if (!pages.length) return '—'
  const runs: [number, number][] = []
  for (const p of pages) {
    const last = runs[runs.length - 1]
    if (last && p === last[1] + 1) last[1] = p
    else runs.push([p, p])
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
}

export default function BookStructure() {
  const [rep, setRep] = useState<StructureReport | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [movePg, setMovePg] = useState('')
  const [moveTo, setMoveTo] = useState('')

  async function reload() {
    const r = await getBookStructure()
    if ('error' in r) { setMsg(r.error); return }
    setRep(r)
  }
  // `.then` with a live flag rather than awaiting inside the effect: setting
  // state synchronously in an effect body cascades renders, and the component
  // can unmount before the first load returns.
  useEffect(() => {
    let live = true
    getBookStructure().then(r => {
      if (!live) return
      if ('error' in r) setMsg(r.error)
      else setRep(r)
    })
    return () => { live = false }
  }, [])

  async function run(what: Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(true); setMsg(null)
    const r = await what
    setBusy(false)
    setMsg(r.ok ? ok : (r.error ?? '操作失败'))
    if (r.ok) { setEditing(null); await reload() }
  }

  if (!rep) {
    return <p className="font-mono text-xs text-ark-muted tracking-widest">
      {msg ? `// ${msg}` : '// 载入中…'}
    </p>
  }

  const dupOwners = new Map<number, number[]>(rep.splitPages.map(s => [s.page, s.chapterIds]))
  const byStory = rep.stories.map(s => ({
    story: s, chapters: rep.chapters.filter(c => c.storyId === s.id),
  }))

  return (
    <div className="space-y-6">
      {(rep.splitPages.length > 0 || rep.emptyChapters.length > 0) && (
        <div className="border border-ark-danger/50 bg-ark-surface/40 p-3 space-y-1">
          <p className="font-mono text-[10px] text-ark-danger tracking-widest uppercase">
            {'//'} 结构问题
          </p>
          {rep.splitPages.map(s => (
            <p key={s.page} className="text-xs text-ark-muted">
              第 {s.page} 页同时属于 {s.chapterIds.length} 个章节（
              {s.chapterIds.map(id => rep.chapters.find(c => c.id === id)?.levelCode ?? id).join(' / ')}
              ）—— 保留一处，其余用「删除重复页」
            </p>
          ))}
          {rep.emptyChapters.map(id => {
            const c = rep.chapters.find(x => x.id === id)
            return (
              <p key={id} className="text-xs text-ark-muted">
                {c?.levelCode} {c?.levelName} 没有任何段落 —— 可直接删除
              </p>
            )
          })}
        </div>
      )}

      {byStory.map(({ story, chapters }) => (
        <section key={story.id} className="space-y-1">
          <h3 className="font-mono text-[11px] text-ark-accent tracking-widest uppercase">
            {'//'} {story.name} · {chapters.length} 章
          </h3>
          <table className="w-full text-xs">
            <tbody>
              {chapters.map((c: ChapterInfo) => {
                const hasDup = c.pages.some(p => dupOwners.get(p)?.includes(c.id))
                return (
                  <tr key={c.id} className="border-b border-ark-border/40 align-top">
                    <td className="py-1 pr-2 font-mono text-[10px] text-ark-border w-12">
                      {c.id}
                    </td>
                    <td className="py-1 pr-2 font-mono text-[10px] text-ark-muted w-20">
                      {c.levelCode ?? '—'}
                    </td>
                    <td className="py-1 pr-2 text-ark-text">
                      {editing === c.id ? (
                        <span className="flex gap-1 flex-wrap">
                          <input value={code} onChange={e => setCode(e.target.value)}
                                 className="w-20 bg-ark-bg border border-ark-border px-1 font-mono text-[10px]" />
                          <input value={name} onChange={e => setName(e.target.value)}
                                 className="flex-1 min-w-40 bg-ark-bg border border-ark-border px-1" />
                          <button disabled={busy} onClick={() => void run(
                            renameChapter(c.id, name, code), '已重命名')}
                                  className="font-mono text-[10px] px-2 border border-ark-accent text-ark-accent">
                            存
                          </button>
                          <button onClick={() => setEditing(null)}
                                  className="font-mono text-[10px] px-2 border border-ark-border text-ark-muted">
                            取消
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => {
                          setEditing(c.id); setName(c.levelName ?? ''); setCode(c.levelCode ?? '')
                        }} className="text-left hover:text-ark-accent">
                          {c.levelName || <span className="text-ark-border">（无名）</span>}
                        </button>
                      )}
                    </td>
                    <td className="py-1 pr-2 font-mono text-[10px] text-ark-muted w-36 whitespace-nowrap">
                      p{spanOf(c.pages)}
                    </td>
                    <td className="py-1 pr-2 font-mono text-[10px] text-ark-border w-14 text-right">
                      {c.nodes}
                    </td>
                    <td className="py-1 font-mono text-[10px] w-28">
                      {c.nodes === 0 && (
                        <button disabled={busy} onClick={() => void run(
                          deleteChapter(c.id), '已删除空章节')}
                                className="text-ark-danger/80 hover:text-ark-danger">
                          删除空章节
                        </button>
                      )}
                      {hasDup && (
                        <span className="text-ark-danger"> 有重复页</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      <div className="border border-ark-border p-3 space-y-2">
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
          {'//'} 移动一页到其他章节
        </p>
        <p className="text-[10px] text-ark-muted leading-relaxed">
          把某个印刷页的全部段落移到另一章节，两边都会按（页码，原顺序）重新编号，
          所以阅读顺序仍与印刷顺序一致。若该页同时属于两个章节，
          选择要<b className="text-ark-text">丢弃</b>副本的那一个再按「删除重复页」。
        </p>
        <div className="flex gap-2 flex-wrap items-center font-mono text-[10px]">
          <input value={movePg} onChange={e => setMovePg(e.target.value)}
                 placeholder="页码" inputMode="numeric"
                 className="w-20 bg-ark-bg border border-ark-border px-2 py-1" />
          <select value={moveTo} onChange={e => setMoveTo(e.target.value)}
                  className="bg-ark-bg border border-ark-border px-2 py-1 max-w-80">
            <option value="">选择目标章节…</option>
            {rep.chapters.map(c => (
              <option key={c.id} value={c.id}>
                {c.storyName} · {c.levelCode} {c.levelName}
              </option>
            ))}
          </select>
          <button disabled={busy || !movePg || !moveTo}
                  onClick={() => void run(
                    movePage(Number(movePg), Number(moveTo)), '已移动该页')}
                  className="px-3 py-1 border border-ark-accent text-ark-accent
                             hover:bg-ark-accent hover:text-ark-bg disabled:opacity-30">
            移动
          </button>
          <button disabled={busy || !movePg || !moveTo}
                  onClick={() => void run(
                    dropDuplicatePage(Number(movePg), Number(moveTo)), '已删除重复页')}
                  className="px-3 py-1 border border-ark-border text-ark-muted
                             hover:text-ark-danger hover:border-ark-danger/60 disabled:opacity-30">
            删除重复页
          </button>
        </div>
      </div>

      {msg && <p className="font-mono text-[10px] text-ark-muted">{'// ' + msg}</p>}
    </div>
  )
}
