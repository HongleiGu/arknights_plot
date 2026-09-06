'use client'

// Whole-archive summary back-fill (AP-29).
//
// SummariesPanel handles one story at a time and needs its id typed in; that is
// fine for a re-run, useless for the ~1600-item backlog AP-30 depends on.
//
// The loop lives here rather than on the server because a back-fill takes far
// longer than any request may: each server call is time-boxed, and this keeps
// asking for another slice. Closing the tab is a pause, not a loss — the
// backlog query is the cursor, so restarting picks up exactly where it stopped.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSummaryBacklog, runSummaryBatch, type SummaryBacklog } from '@/app/actions/summaries'

// Rate-limit backoff. The free model's ceiling is per-minute, so a short first
// wait usually clears it; doubling keeps a sustained block from spinning.
const BACKOFF_START = 20_000
const BACKOFF_MAX = 5 * 60_000

export default function BacklogPanel() {
  const [stat, setStat] = useState<SummaryBacklog | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<{ id: number; kind: string; error: string }[]>([])

  // Ref, not state: the loop reads it every iteration and must see the current
  // value — a captured state variable would keep the value it had at start.
  const stop = useRef(false)

  const apply = useCallback((s: SummaryBacklog | { error: string }) => {
    if ('error' in s) setErr(s.error)
    else { setErr(null); setStat(s) }
  }, [])

  const refresh = useCallback(async () => apply(await getSummaryBacklog()), [apply])

  // `.then` with a live flag rather than an inline await: the effect body must
  // not call setState synchronously (cascading renders — the same rule
  // CiteSearch documents), and the flag drops a response that lands after
  // unmount.
  useEffect(() => {
    let live = true
    getSummaryBacklog().then(s => { if (live) apply(s) })
    return () => { live = false }
  }, [apply])

  async function start() {
    if (running) return
    stop.current = false
    setRunning(true); setErr(null); setNote(null); setDone(0); setFailed([])

    let backoff = BACKOFF_START
    while (!stop.current) {
      const r = await runSummaryBatch()
      if (r.error) { setErr(r.error); break }

      setDone(d => d + r.processed)
      // Cap the visible list: a systemic failure would otherwise render
      // hundreds of identical rows and bury the useful ones.
      if (r.failed.length) setFailed(f => [...f, ...r.failed].slice(0, 50))

      if (r.rateLimited) {
        setNote(`触发限流，等待 ${Math.round(backoff / 1000)} 秒后继续…`)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, BACKOFF_MAX)
        continue
      }
      backoff = BACKOFF_START
      setNote(null)

      // A slice that produced nothing and hit no limit means the queue is
      // empty or every remaining item fails deterministically — either way,
      // looping again would just spin.
      if (r.processed === 0 && r.failed.length === 0) break
      if (r.remaining <= 0) break
      await refresh()
    }

    setRunning(false)
    setNote(stop.current ? '已停止（进度已保存，可随时继续）' : '本轮结束')
    await refresh()
  }

  const pct = stat && stat.chaptersTotal
    ? Math.round(((stat.chaptersDone + stat.storiesDone) / (stat.chaptersTotal + stat.storiesTotal)) * 100)
    : 0

  return (
    <section className="border border-ark-border p-4 mt-6 space-y-4 font-mono text-[12px]">
      <p className="text-[10px] text-ark-muted tracking-widest uppercase">{'//'} 摘要全量补齐</p>

      {stat && (
        <div className="space-y-2">
          <div className="h-1 bg-ark-surface">
            <div className="h-full bg-ark-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-ark-muted">
            章节 <span className="text-ark-text">{stat.chaptersDone}</span>/{stat.chaptersTotal}
            {' · '}剩余 <span className="text-ark-accent">{stat.chaptersTodo}</span>
            {'　'}剧情 <span className="text-ark-text">{stat.storiesDone}</span>/{stat.storiesTotal}
            {' · '}剩余 <span className="text-ark-accent">{stat.storiesTodo}</span>
          </p>
          <p className="text-[10px] text-ark-muted">
            已有 wiki 官方描述的章节视为完成，不重复生成。
          </p>
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={start} disabled={running}
          className="px-3 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg
                     disabled:opacity-40 tracking-widest uppercase transition-colors">
          {running ? '生成中…' : '开始补齐'}
        </button>
        <button
          onClick={() => { stop.current = true }} disabled={!running}
          className="px-3 py-1 border border-ark-border text-ark-muted hover:text-ark-danger
                     hover:border-ark-danger/60 disabled:opacity-40 tracking-widest uppercase transition-colors">
          停止
        </button>
        <button
          onClick={refresh} disabled={running}
          className="px-3 py-1 border border-ark-border text-ark-muted hover:text-ark-accent
                     hover:border-ark-accent-dim disabled:opacity-40 tracking-widest uppercase transition-colors">
          刷新
        </button>
        {running && <span className="text-ark-accent">本次已生成 {done}</span>}
      </div>

      {note && <p className="text-ark-muted">{'// ' + note}</p>}
      {err && <p className="text-ark-danger">{'// ' + err}</p>}

      {failed.length > 0 && (
        <details className="text-[11px]">
          <summary className="text-ark-danger cursor-pointer">跳过 {failed.length} 条（点击展开）</summary>
          <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {failed.map((f, i) => (
              <li key={`${f.kind}-${f.id}-${i}`} className="text-ark-muted">
                {f.kind}/{f.id} — {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[10px] text-ark-muted">
        逐条计费（计入 AI 预算）。可随时停止，进度保存在数据库里，下次从断点继续。
      </p>
    </section>
  )
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
