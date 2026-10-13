'use client'

// Run speaker resolution across the whole corpus (046).
//
// 8,325 (story, speaker) pairs over 443 stories is ~463 model calls at roughly
// half a minute each, so this cannot be a button you press 463 times, and it
// has to survive the tab closing. Same shape as AP-29's 摘要全量补齐: the server
// does one 20s slice, the client keeps asking, and the backlog query is the
// cursor — so stopping is a pause, not a loss.
//
// Autorun is OPT-IN and stoppable. A run that spends money for hours should be
// something you started on purpose and can end with one click.

import { useCallback, useEffect, useRef, useState } from 'react'
import { runSpeakerRoleCorpusBatch, type CorpusBatchResult } from '@/app/actions/speakerRoles'

interface Totals {
  slices: number
  stories: number
  written: number
  orgs: string[]
  unanchored: { speaker: string; proposed: string }[]
  dropped: { speaker: string; why: string }[]
}

const ZERO: Totals = {
  slices: 0, stories: 0, written: 0, orgs: [], unanchored: [], dropped: [],
}

export default function SpeakerRoleCorpusPanel() {
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<CorpusBatchResult | null>(null)
  const [totals, setTotals] = useState<Totals>(ZERO)
  const [err, setErr] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(0)
  // A ref, not state: the loop reads it between slices and must see the current
  // value rather than the one captured when it started.
  const go = useRef(false)

  const slice = useCallback(async () => {
    const r = await runSpeakerRoleCorpusBatch()
    setLast(r)
    if (r.error) { setErr(r.error); go.current = false; setRunning(false); return r }
    setTotals(t => ({
      slices: t.slices + 1,
      stories: t.stories + r.stories,
      written: t.written + r.written,
      orgs: [...t.orgs, ...r.createdOrgs],
      unanchored: [...t.unanchored, ...r.unanchored].slice(-40),
      dropped: [...t.dropped, ...r.dropped].slice(-40),
    }))
    return r
  }, [])

  // The loop lives in an effect so React owns its lifetime; `go` gates it.
  useEffect(() => {
    if (!running) return
    let cancelled = false
    go.current = true
    ;(async () => {
      // 429 backoff mirrors AP-29: 20s, doubling to 5 minutes. On a long run the
      // alternative is spending the rest of the quota on retries.
      let backoff = 20_000
      while (go.current && !cancelled) {
        const r = await slice()
        if (!r || r.error) break
        if (r.remaining <= 0 && r.stories === 0) break
        if (r.rateLimited) {
          for (let s = backoff / 1000; s > 0 && go.current && !cancelled; s--) {
            setWaiting(s)
            await new Promise(res => setTimeout(res, 1000))
          }
          setWaiting(0)
          backoff = Math.min(backoff * 2, 300_000)
        } else {
          backoff = 20_000
        }
      }
      if (!cancelled) { setRunning(false); go.current = false }
    })()
    return () => { cancelled = true; go.current = false }
  }, [running, slice])

  return (
    <section className="border border-ark-border p-4 mb-8">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] text-ark-text font-sans">全量指代解析</h2>
        <p className="text-[10px] text-ark-muted uppercase tracking-widest">
          {'// SPEAKER RESOLUTION · WHOLE CORPUS'}
        </p>
        <button
          onClick={() => { setErr(null); setRunning(r => !r) }}
          className={`ml-auto text-[10px] uppercase tracking-widest px-3 py-1 border
            ${running
              ? 'border-ark-danger text-ark-danger hover:bg-ark-danger/10'
              : 'border-ark-accent-dim text-ark-accent hover:bg-ark-accent/10'}`}
        >
          {running ? '停止' : '开始'}
        </button>
        <button
          onClick={() => { setErr(null); void slice() }} disabled={running}
          className="text-[10px] uppercase tracking-widest px-3 py-1 border border-ark-border
                     text-ark-muted hover:text-ark-text disabled:opacity-40"
        >
          只跑一片
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ark-muted leading-relaxed font-sans">
        按「还有多少说话人没判定」从多到少跑，每片 20 秒，跑完一片自动接着下一片。
        <b className="text-ark-text">积压查询本身就是游标</b>——已经有解析行的说话人会被跳过，
        所以关掉页面只是暂停，不会丢进度，也不需要任务表。
        遇到 429 会等 20 秒再试，逐次加倍到 5 分钟；某个故事解析失败只会被跳过，不会中断整轮。
      </p>

      {err && <p className="mt-3 text-[11px] text-ark-danger">{err}</p>}

      <div className="mt-3 flex gap-4 flex-wrap text-[10px] uppercase tracking-widest">
        <span className="text-ark-muted">片 <b className="text-ark-text">{totals.slices}</b></span>
        <span className="text-ark-muted">故事 <b className="text-ark-text">{totals.stories}</b></span>
        <span className="text-ark-muted">写入 <b className="text-ark-success">{totals.written}</b></span>
        {last && (
          /* 约, not an exact count: the progress function counts speakers with no
             JUDGEMENT while this table holds RESOLUTIONS, and the two
             denominators are not the same. It is a gauge, not an invariant. */
          <span className="text-ark-muted">
            剩余约 <b className="text-ark-text">{last.remaining.toLocaleString()}</b>
          </span>
        )}
        {totals.orgs.length > 0 && (
          <span className="text-ark-muted">
            新建组织 <b className="text-ark-accent">{totals.orgs.length}</b>
          </span>
        )}
        {waiting > 0 && (
          <span className="text-ark-danger">限流等待 {waiting}s</span>
        )}
        {running && waiting === 0 && <span className="text-ark-accent">运行中…</span>}
      </div>

      {totals.orgs.length > 0 && (
        <p className="mt-2 text-[10px] text-ark-accent leading-relaxed">
          {'//'} 新建组织（均为待复核）：{[...new Set(totals.orgs)].join('、')}
        </p>
      )}

      {totals.unanchored.length > 0 && (
        <details className="mt-2">
          <summary className="text-[10px] text-ark-muted uppercase tracking-widest cursor-pointer">
            {'//'} 未挂靠的提议 {totals.unanchored.length}（判定已保留）
          </summary>
          <ul className="mt-1 pl-3 space-y-0.5">
            {totals.unanchored.map((u, i) => (
              <li key={i} className="text-[10px] text-ark-muted">
                「{u.speaker}」→「{u.proposed}」
              </li>
            ))}
          </ul>
        </details>
      )}

      {totals.dropped.length > 0 && (
        <details className="mt-2" open>
          <summary className="text-[10px] text-ark-danger uppercase tracking-widest cursor-pointer">
            {'//'} 丢弃 {totals.dropped.length} —— 这里的内容决定要不要调提示词
          </summary>
          <ul className="mt-1 pl-3 space-y-0.5">
            {totals.dropped.map((d, i) => (
              <li key={i} className="text-[10px] text-ark-danger/80">
                {d.speaker}：{d.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
