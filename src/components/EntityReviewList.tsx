'use client'

// The review queue's rows (AP-35/AP-36, migration 044).
//
// Each row is one judgement: is this name a person (named), a role standing in
// for many people (scoped), or not an entity at all (device)? That cannot be
// derived, so the row's job is to put the evidence next to the buttons —
// `getEntityEvidence` is loaded on demand because 医疗干员 needs its 44 stories
// shown and 阿米娅 obviously needs nothing.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  getEntityEvidence, setEntityIdentity, setEntityReview,
  updateEntityNames, deleteEntity,
} from '@/app/actions/entities'
import {
  IDENTITY_LABEL, type Identity, type ReviewRow, type EvidenceStory,
} from '@/lib/graph'

const CHOICES: { key: Identity; hint: string }[] = [
  { key: 'named', hint: '真实人物，全局唯一（塔露拉、魏彦吾）' },
  { key: 'scoped', hint: '泛指身份，各故事里是不同的人（医疗干员、维多利亚士兵）' },
  { key: 'device', hint: '不是人物（众人、广播、门外的声音）' },
]

export default function EntityReviewList({ rows }: { rows: ReviewRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map(r => <Row key={r.id} row={r} />)}
      {!rows.length && (
        <li className="border border-ark-border p-6 text-center text-ark-muted text-[11px]">
          {'//'} 没有符合条件的实体
        </li>
      )}
    </ul>
  )
}

function Row({ row }: { row: ReviewRow }) {
  const [state, setState] = useState(row)
  const [evidence, setEvidence] = useState<EvidenceStory[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(row.reviewNote ?? '')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(row.name)
  const [aliases, setAliases] = useState((row.aliases ?? []).join('、'))
  const [err, setErr] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [pending, start] = useTransition()

  if (gone) return null

  const loadEvidence = () => {
    setOpen(o => !o)
    if (evidence) return
    start(async () => {
      const r = await getEntityEvidence(row.id)
      if ('error' in r) { setErr(r.error); return }
      setEvidence(r.stories)
      setTruncated(r.truncated)
    })
  }

  const judge = (identity: Identity) => start(async () => {
    setErr(null)
    const r = await setEntityIdentity(row.id, identity, note)
    if ('error' in r) { setErr(r.error); return }
    setState(s => ({ ...s, identity, review: 'reviewed', reviewNote: note || null }))
  })

  const flag = () => start(async () => {
    setErr(null)
    const r = await setEntityReview(row.id, 'suspicious', note)
    if ('error' in r) { setErr(r.error); return }
    setState(s => ({ ...s, review: 'suspicious' }))
  })

  const saveNames = () => start(async () => {
    setErr(null)
    const r = await updateEntityNames(row.id, {
      name,
      aliases: aliases.split(/[、,，\s]+/).filter(Boolean),
    })
    if ('error' in r) { setErr(r.error); return }
    setState(s => ({ ...s, name, aliases: aliases.split(/[、,，\s]+/).filter(Boolean) }))
    setEditing(false)
  })

  const remove = () => start(async () => {
    setErr(null)
    const r = await deleteEntity(row.id)
    if ('error' in r) { setErr(r.error); return }
    setGone(true)
  })

  const tone =
    state.identity === 'named' ? 'border-ark-success/40'
      : state.identity === 'scoped' ? 'border-ark-accent/40'
        : state.identity === 'device' ? 'border-ark-danger/40'
          : state.review === 'suspicious' ? 'border-ark-danger/60'
            : 'border-ark-border'

  return (
    <li className={`border ${tone} p-3 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] text-ark-muted uppercase tracking-widest">
          {state.type}
        </span>
        {editing ? (
          <input
            value={name} onChange={e => setName(e.target.value)}
            className="bg-ark-bg-2 border border-ark-border px-2 py-0.5 text-ark-text text-[13px]"
          />
        ) : (
          <Link href={`/world/${row.id}`} className="text-[14px] text-ark-text hover:text-ark-accent">
            {state.name}
          </Link>
        )}
        {state.nameEn && <span className="text-[10px] text-ark-muted">{state.nameEn}</span>}
        <span className="text-[10px] text-ark-muted">
          {'//'} {state.mentionCount.toLocaleString()} 行
        </span>
        <span className="text-[10px] text-ark-muted">
          {IDENTITY_LABEL[state.identity]}
          {state.review === 'suspicious' && ' · 待复核'}
          {state.review === 'reviewed' && ' · 已复核'}
        </span>
        <button
          onClick={loadEvidence}
          className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                     hover:text-ark-accent-bright"
        >
          {'//'} {open ? '收起' : '证据'}
        </button>
      </div>

      {editing && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-ark-muted uppercase tracking-widest">别名</label>
          <input
            value={aliases} onChange={e => setAliases(e.target.value)}
            placeholder="官方写明的别名，顿号分隔"
            className="flex-1 min-w-[16rem] bg-ark-bg-2 border border-ark-border px-2 py-0.5
                       text-ark-text text-[12px]"
          />
          <button onClick={saveNames} className="text-[10px] uppercase tracking-widest text-ark-success">
            保存
          </button>
          <button onClick={() => setEditing(false)} className="text-[10px] uppercase tracking-widest text-ark-muted">
            取消
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3 border-l border-ark-border pl-3 space-y-2">
          {evidence === null && <p className="text-[10px] text-ark-muted">{'//'} 读取中…</p>}
          {evidence?.length === 0 && (
            <p className="text-[10px] text-ark-muted">
              {'//'} 没有台词（不是来自 speaker 的实体）
            </p>
          )}
          {evidence && evidence.length > 0 && (
            <>
              <p className="text-[10px] text-ark-muted uppercase tracking-widest">
                {'//'} 出现在 {evidence.length} 个故事
                {truncated && '（仅统计前 400 行）'}
                {evidence.length >= 5 && ' · 跨故事越多越可能是泛指'}
              </p>
              <ul className="space-y-1.5">
                {evidence.slice(0, 12).map(s => (
                  <li key={s.storyId} className="text-[11px]">
                    <span className="text-ark-text">{s.storyName}</span>
                    <span className="text-ark-muted"> · {s.category} · {s.lines} 行</span>
                    {s.samples.map((t, i) => (
                      <p key={i} className="text-ark-muted pl-3 leading-relaxed">「{t}」</p>
                    ))}
                  </li>
                ))}
                {evidence.length > 12 && (
                  <li className="text-[10px] text-ark-muted">
                    {'//'} 还有 {evidence.length - 12} 个故事
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {CHOICES.map(c => (
          <button
            key={c.key} title={c.hint} onClick={() => judge(c.key)}
            className={`text-[10px] uppercase tracking-widest px-2 py-1 border transition-colors
              ${state.identity === c.key
                ? 'border-ark-accent text-ark-accent'
                : 'border-ark-border text-ark-muted hover:border-ark-accent-dim hover:text-ark-text'}`}
          >
            {IDENTITY_LABEL[c.key]}
          </button>
        ))}
        <button
          onClick={flag}
          className="text-[10px] uppercase tracking-widest px-2 py-1 border border-ark-border
                     text-ark-muted hover:border-ark-danger hover:text-ark-danger"
        >
          标记待复核
        </button>
        <input
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="备注（随判定一起保存）"
          className="flex-1 min-w-[12rem] bg-ark-bg-2 border border-ark-border px-2 py-1
                     text-ark-text text-[11px]"
        />
        <button
          onClick={() => setEditing(e => !e)}
          className="text-[10px] uppercase tracking-widest text-ark-muted hover:text-ark-text"
        >
          改名/别名
        </button>
        {state.identity === 'device' && (
          <button
            onClick={() => { if (confirm(`删除 ${state.name}？其关系会一并级联删除。`)) remove() }}
            className="text-[10px] uppercase tracking-widest text-ark-danger/70 hover:text-ark-danger"
          >
            删除
          </button>
        )}
      </div>

      {err && <p className="mt-2 text-[11px] text-ark-danger">{err}</p>}
    </li>
  )
}
