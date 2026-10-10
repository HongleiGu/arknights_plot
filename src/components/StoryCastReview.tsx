'use client'

// One story's cast, judged in place (044/045).
//
// Why per story: name similarity ACROSS stories is where coincidence lives.
// 安娜 is not 薇薇安娜 and 瑟琳 is not 凯瑟琳, so a rule that pairs names by
// spelling does not produce uncertainty, it produces confident mistakes. Inside
// one story the cast is a few dozen names, the lines that answer "is 模糊的声音
// somebody already in the room" are in that room, and a wrong pairing cannot
// arrive from a story nobody opened.
//
// So the alias target is a `<select>` of THIS story's other speakers. Nothing
// proposes a pairing; the reviewer picks one, which is the only thing that can
// be right here.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  setEntityIdentity, mergeEntities, linkSameCharacter,
} from '@/app/actions/entities'
import { IDENTITY_LABEL, type CastRow, type Identity } from '@/lib/graph'

const CHOICES: { key: Identity; hint: string }[] = [
  { key: 'named', hint: '真实人物，全局唯一' },
  { key: 'scoped', hint: '泛指身份，各故事里是不同的人' },
  { key: 'device', hint: '不是人物（众人、广播、门外的声音）' },
]

/**
 * `cast` is what to render; `roster` is the whole story's cast.
 *
 * They differ because the page hides already-reviewed rows, and the alias target
 * is usually one of those — 阿米娅 is reviewed and is exactly who a 模糊的声音
 * might turn out to be. Building the dropdown from the rendered list would hide
 * every plausible target.
 */
export default function StoryCastReview(
  { cast, roster }: { cast: CastRow[]; roster: CastRow[] },
) {
  const targets = roster.filter(c => c.entityId)
  return (
    <ul className="space-y-2">
      {cast.map(c => <Row key={c.name} row={c} others={targets} />)}
      {!cast.length && (
        <li className="border border-ark-border p-6 text-center text-ark-muted text-[11px]">
          {'//'} 这个故事里没有可判定的说话人
        </li>
      )}
    </ul>
  )
}

function Row({ row, others }: { row: CastRow; others: CastRow[] }) {
  const [state, setState] = useState(row)
  const [target, setTarget] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  if (gone) return null

  const judge = (identity: Identity) => start(async () => {
    setErr(null)
    if (!state.entityId) { setErr('这个说话人没有实体行，无法判定'); return }
    const r = await setEntityIdentity(state.entityId, identity)
    if ('error' in r) { setErr(r.error); return }
    setState(s => ({ ...s, identity, review: 'reviewed' }))
    setMsg(`已判为${IDENTITY_LABEL[identity]}`)
  })

  const pick = others.find(o => String(o.entityId) === target)

  // Merge vs link is the one thing still decided by evidence rather than by the
  // reviewer, and the evidence is documentary rather than textual: if the game
  // keeps its own 人员档案 for this name it is a separate record, so linking as
  // 同一人 keeps both and merging would discard one.
  const recommend = state.hasRecord || pick?.hasRecord ? 'link' : 'merge'

  const doMerge = () => {
    if (!pick || !state.entityId) return
    const extra = state.hasRecord
      ? `\n\n注意：「${state.name}」有自己的官方人员档案，合并会丢掉那一份。一般应该用「同一人」。`
      : ''
    if (!confirm(
      `把「${state.name}」合并进「${pick.name}」？\n\n`
      + `关系、评论锚点、板块节点都会改指向「${pick.name}」，`
      + `「${state.name}」会成为它的别名，然后该行被删除。不可撤销。${extra}`,
    )) return
    start(async () => {
      setErr(null)
      const r = await mergeEntities(pick.entityId!, state.entityId!)
      if ('error' in r) { setErr(r.error); return }
      setGone(true)
    })
  }

  const doLink = () => {
    if (!pick || !state.entityId) return
    start(async () => {
      setErr(null)
      const r = await linkSameCharacter(pick.entityId!, state.entityId!)
      if ('error' in r) { setErr(r.error); return }
      setMsg(`已标记与「${pick.name}」同一人`
        + (r.cited ? `（引用 ${r.cited}）` : '（无引用，记为 manual）'))
    })
  }

  const tone =
    state.identity === 'named' ? 'border-ark-success/40'
      : state.identity === 'scoped' ? 'border-ark-accent/40'
        : state.identity === 'device' ? 'border-ark-danger/40'
          : !state.entityId ? 'border-ark-danger/60'
            : 'border-ark-border'

  // A name whose lines are almost all in this story belongs to it; one with far
  // more elsewhere is something other stories reuse. That contrast is the
  // judgement, so it is shown rather than left to be worked out.
  const elsewhere = Math.max(0, state.linesTotal - state.linesHere)

  return (
    <li className={`border ${tone} p-3 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex items-baseline gap-3 flex-wrap">
        {state.entityId ? (
          <Link href={`/world/${state.entityId}`}
                className="text-[14px] text-ark-text hover:text-ark-accent">
            {state.name}
          </Link>
        ) : (
          <span className="text-[14px] text-ark-text">{state.name}</span>
        )}
        <span className="text-[10px] text-ark-muted">
          {'//'} 本故事 {state.linesHere} 行
          {elsewhere > 0 && ` · 其他故事 ${elsewhere} 行`}
        </span>
        {state.hasRecord && (
          <span className="text-[9px] uppercase tracking-widest text-ark-success">有档案</span>
        )}
        {!state.entityId && (
          <span className="text-[9px] uppercase tracking-widest text-ark-danger">无实体行</span>
        )}
        <span className="text-[10px] text-ark-muted">
          {state.identity ? IDENTITY_LABEL[state.identity] : '—'}
          {state.review === 'suspicious' && ' · 待复核'}
          {state.review === 'reviewed' && ' · 已复核'}
        </span>
        {state.samples.length > 0 && (
          <button onClick={() => setOpen(o => !o)}
                  className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                             hover:text-ark-accent-bright">
            {'//'} {open ? '收起' : '台词'}
          </button>
        )}
      </div>

      {state.reviewNote && (
        <p className="mt-1 text-[10px] text-ark-muted leading-relaxed">
          {'//'} {state.reviewNote}
        </p>
      )}

      {open && (
        <ul className="mt-2 border-l border-ark-border pl-3 space-y-1">
          {state.samples.map((t, i) => (
            <li key={i} className="text-[11px] text-ark-muted leading-relaxed">「{t}」</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {CHOICES.map(c => (
          <button key={c.key} title={c.hint} onClick={() => judge(c.key)}
                  disabled={pending || !state.entityId}
                  className={`text-[10px] uppercase tracking-widest px-2 py-1 border transition-colors
                    disabled:opacity-40
                    ${state.identity === c.key
                      ? 'border-ark-accent text-ark-accent'
                      : 'border-ark-border text-ark-muted hover:border-ark-accent-dim hover:text-ark-text'}`}>
            {IDENTITY_LABEL[c.key]}
          </button>
        ))}

        <span className="flex items-center gap-1 ml-2">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">是谁的别名</span>
          <select value={target} onChange={e => { setTarget(e.target.value); setMsg(null) }}
                  className="bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text text-[11px]
                             max-w-[12rem]">
            <option value="">—</option>
            {others.filter(o => o.name !== state.name).map(o => (
              <option key={o.entityId} value={String(o.entityId)}>
                {o.name}（{o.linesHere} 行{o.hasRecord ? ' · 有档案' : ''}）
              </option>
            ))}
          </select>
          {pick && (
            <>
              <button onClick={recommend === 'link' ? doLink : doMerge} disabled={pending}
                      className={`text-[10px] uppercase tracking-widest px-2 py-1 border
                        disabled:opacity-50
                        ${recommend === 'link'
                          ? 'border-ark-accent-dim text-ark-accent hover:bg-ark-accent/10'
                          : 'border-ark-success/50 text-ark-success hover:bg-ark-success/10'}`}>
                {recommend === 'link' ? '标记同一人' : '合并'}
              </button>
              <button onClick={recommend === 'link' ? doMerge : doLink} disabled={pending}
                      className="text-[10px] uppercase tracking-widest px-2 py-1 border
                                 border-ark-border text-ark-muted hover:text-ark-text
                                 disabled:opacity-50">
                {recommend === 'link' ? '仍要合并' : '只标记同一人'}
              </button>
            </>
          )}
        </span>
      </div>

      {msg && <p className="mt-2 text-[10px] text-ark-success">{'//'} {msg}</p>}
      {err && <p className="mt-2 text-[11px] text-ark-danger">{err}</p>}
    </li>
  )
}
