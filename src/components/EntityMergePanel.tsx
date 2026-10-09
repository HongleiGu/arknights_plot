'use client'

// Alias resolution: two rows that are one character (044).
//
// The candidates are grounded, not fuzzy — one name containing another AND the
// longer one's official 客观履历 opening by naming the shorter. 荒芜拉普兰德's
// reads "拉普兰德，无业，叙拉古萨卢佐家族现任家主阿尔贝托的独女…", which is the game
// saying they are the same person.
//
// MERGE IS NOT ALWAYS THE RIGHT ANSWER, so both actions are offered. An
// alternate operator form has its OWN official 客观履历, and merging discards one
// of the two; `同一人` is a relation kind, so linking keeps both records and
// still answers "who is this". Merge is for a true duplicate — one character
// that ended up as two rows.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  findMergeCandidates, mergeEntities, linkSameCharacter, type MergeCandidate,
} from '@/app/actions/entities'

export default function EntityMergePanel() {
  const [cands, setCands] = useState<MergeCandidate[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [keepId, setKeepId] = useState('')
  const [dropId, setDropId] = useState('')
  const [manual, setManual] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const describe = (x: Awaited<ReturnType<typeof mergeEntities>>) =>
    'error' in x ? `失败：${x.error}`
      : `已合并 · 关系迁移 ${x.report.relationsMoved}／丢弃 ${x.report.relationsDropped}`
        + ` · 评论 ${x.report.commentsMoved} · 板块节点 ${x.report.boardMembersMoved}`
        + ` · 改写引用 ${x.report.boardTextRewritten}`
        + (x.report.aliasesAdded.length ? ` · 新别名 ${x.report.aliasesAdded.join('、')}` : '')
        + (x.report.tookSummary ? ' · 沿用了被合并行的简介' : '')

  const mergeIds = (k: number, d: number) => start(async () => {
    setErr(null)
    const r = await mergeEntities(k, d)
    setManual(describe(r))
    if (!('error' in r)) { setKeepId(''); setDropId('') }
  })

  const load = () => start(async () => {
    setErr(null)
    const r = await findMergeCandidates()
    if ('error' in r) { setErr(r.error); return }
    setCands(r.candidates)
  })

  const merge = (c: MergeCandidate) => start(async () => {
    setErr(null)
    const r = await mergeEntities(c.keepId, c.dropId)
    setDone(d => ({ ...d, [`${c.keepId}-${c.dropId}`]: describe(r) }))
  })

  const confirmMerge = (c: MergeCandidate) => {
    const extra = c.kind === 'alt'
      ? `\n\n注意：「${c.dropName}」有自己的官方客观履历，合并会丢掉那一份。`
        + `\n一般应该用「标记同一人」。`
      : ''
    if (confirm(
      `把「${c.dropName}」合并进「${c.keepName}」？\n\n`
      + `关系、评论锚点、板块节点都会改指向「${c.keepName}」，`
      + `「${c.dropName}」会成为它的别名，然后该行被删除。不可撤销。${extra}`,
    )) merge(c)
  }

  const link = (c: MergeCandidate) => start(async () => {
    setErr(null)
    const r = await linkSameCharacter(c.keepId, c.dropId)
    setDone(d => ({
      ...d,
      [`${c.keepId}-${c.dropId}`]: 'error' in r
        ? `失败：${r.error}`
        : `已标记同一人（两份档案都保留）`
          + (r.cited ? ` · 引用 ${r.cited}` : ' · 无引用，记为 manual'),
    }))
  })

  return (
    <section className="border border-ark-border p-4 mb-8">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] text-ark-text font-sans">别名归并</h2>
        <p className="text-[10px] text-ark-muted uppercase tracking-widest">
          {'// ALIAS RESOLUTION'}
        </p>
        <button
          onClick={load} disabled={pending}
          className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                     hover:text-ark-accent-bright disabled:opacity-50"
        >
          {'//'} {cands ? '重新查找' : '查找候选'}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ark-muted leading-relaxed font-sans">
        候选只取<b className="text-ark-text">有据可查</b>的一种：一个名字包含另一个
        （荒芜拉普兰德 ⊃ 拉普兰德，这正是游戏给干员异格形态起名的方式），
        <b className="text-ark-text">并且</b>较长那个的官方客观履历开头就称其为较短的那个
        ——「拉普兰德，无业，叙拉古萨卢佐家族现任家主阿尔贝托的独女……」。
        只有包含关系的有 4,810 对，领头的是 曼弗雷德→雷德、华法琳→法琳，
        把那些做成一键不可撤销的合并是危险的，所以不列出。
      </p>
      <p className="mt-2 text-[11px] text-ark-muted leading-relaxed font-sans">
        <b className="text-ark-text">两种情况，两种做法，判据是文档而不是感觉：
        这一行有没有自己的官方人员档案。</b>
      </p>
      <ul className="mt-2 pl-4 text-[11px] text-ark-muted leading-relaxed font-sans space-y-1">
        <li>
          <b className="text-ark-text">异格</b>（有自己的档案）——同一个人，但各有一份
          官方客观履历，侧重的性格面不同。推荐<b className="text-ark-text">标记同一人</b>：
          两份档案都留着，又答得出「这是谁」。合并会丢掉其中一份。实测 17 个候选，
          17 个都有自己的档案。
        </li>
        <li>
          <b className="text-ark-text">昵称／简称</b>（没有档案）——只在台词里出现过的叫法，
          一个角色变成了两行。推荐<b className="text-ark-text">合并</b>。
          判据是<b className="text-ark-text">前缀</b>而不是包含：6 个包含关系里有 4 个
          只是音译的尾字巧合（安娜←薇薇安娜、瑟琳←凯瑟琳、威尔←诺威尔、法琳←华法琳），
          而简称保留开头（幽灵←幽灵鲨、薇薇安←薇薇安娜）。
        </li>
      </ul>

      {/* For a pair the admin spots that no rule proposes. Ids rather than
          names, because a name is not unique across types and a typo here
          is irreversible. */}
      <div className="mt-3 flex items-end gap-2 flex-wrap text-[11px]">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">保留 id</span>
          <input value={keepId} onChange={e => setKeepId(e.target.value)} inputMode="numeric"
                 className="w-24 bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">合并掉 id</span>
          <input value={dropId} onChange={e => setDropId(e.target.value)} inputMode="numeric"
                 className="w-24 bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text" />
        </label>
        <button
          onClick={() => {
            const k = parseInt(keepId, 10), d = parseInt(dropId, 10)
            if (!k || !d) { setErr('两个 id 都要填'); return }
            if (confirm(`把实体 ${d} 合并进 ${k}？不可撤销。`)) mergeIds(k, d)
          }}
          disabled={pending}
          className="border border-ark-border px-2 py-1 text-[10px] uppercase tracking-widest
                     text-ark-muted hover:border-ark-danger hover:text-ark-danger
                     disabled:opacity-50"
        >
          手动合并
        </button>
        {manual && <span className="text-[10px] text-ark-success">{'//'} {manual}</span>}
      </div>

      {err && <p className="mt-3 text-[11px] text-ark-danger">{err}</p>}
      {cands?.length === 0 && (
        <p className="mt-3 text-[11px] text-ark-muted">{'//'} 没有找到候选</p>
      )}

      {cands && cands.length > 0 && (
        <ul className="mt-4 space-y-2">
          {cands.map(c => {
            const key = `${c.keepId}-${c.dropId}`
            const isAlt = c.kind === 'alt'
            return (
              <li key={key}
                  className={`border p-2 ${isAlt ? 'border-ark-accent/40' : 'border-ark-success/40'}`}>
                <div className="flex items-baseline gap-2 flex-wrap text-[12px]">
                  <span className={`text-[9px] uppercase tracking-widest px-1
                    ${isAlt ? 'text-ark-accent' : 'text-ark-success'}`}>
                    {isAlt ? '异格' : '昵称'}
                  </span>
                  <Link href={`/world/${c.dropId}`} className="text-ark-text hover:text-ark-accent">
                    {c.dropName}
                  </Link>
                  <span className="text-[10px] text-ark-muted">{c.dropLines} 行</span>
                  <span className="text-ark-muted">{isAlt ? '↔' : '→'}</span>
                  <Link href={`/world/${c.keepId}`} className="text-ark-text hover:text-ark-accent">
                    {c.keepName}
                  </Link>
                  <span className="text-[10px] text-ark-muted">{c.keepLines} 行</span>
                  {!done[key] && (
                    <span className="ml-auto flex gap-2">
                      {/* The recommended action is listed first; the other stays
                          available, because the rule is evidence and not a
                          verdict. */}
                      {isAlt ? (
                        <>
                          <button
                            onClick={() => link(c)} disabled={pending}
                            className="text-[10px] uppercase tracking-widest px-2 py-0.5
                                       border border-ark-accent-dim text-ark-accent
                                       hover:bg-ark-accent/10 disabled:opacity-50"
                          >
                            标记同一人
                          </button>
                          <button
                            onClick={() => confirmMerge(c)} disabled={pending}
                            className="text-[10px] uppercase tracking-widest px-2 py-0.5
                                       border border-ark-border text-ark-muted
                                       hover:border-ark-danger hover:text-ark-danger
                                       disabled:opacity-50"
                          >
                            仍要合并
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => confirmMerge(c)} disabled={pending}
                            className="text-[10px] uppercase tracking-widest px-2 py-0.5
                                       border border-ark-success/50 text-ark-success
                                       hover:bg-ark-success/10 disabled:opacity-50"
                          >
                            合并
                          </button>
                          <button
                            onClick={() => link(c)} disabled={pending}
                            className="text-[10px] uppercase tracking-widest px-2 py-0.5
                                       border border-ark-border text-ark-muted
                                       hover:border-ark-accent-dim hover:text-ark-accent
                                       disabled:opacity-50"
                          >
                            只标记同一人
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-[10px] ${isAlt ? 'text-ark-accent' : 'text-ark-muted'}`}>
                  {'//'} {c.basis}
                </p>
                {done[key] && (
                  <p className="mt-1 text-[10px] text-ark-success">{'//'} {done[key]}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
