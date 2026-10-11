'use client'

// Per-story speaker resolution (046): run the model over this story's labels,
// then fix what it got wrong.
//
// Each row is a claim with a required reason and a node citation the model was
// actually shown — `resolveStorySpeakers` drops any citation it was not given,
// so a row here cites evidence that exists. Editing a row flips `source` to
// `manual`, because then it is your claim rather than the model's.

import { useState, useTransition } from 'react'
import {
  resolveStorySpeakers, listSpeakerRoles, updateSpeakerRole,
  type ResolveReport,
} from '@/app/actions/speakerRoles'
import { ROLE_KINDS, ROLE_LABEL, type RoleKind, type SpeakerRoleRow } from '@/lib/graph'

export default function SpeakerRolePanel(
  { storyId, initial }: { storyId: number; initial: SpeakerRoleRow[] },
) {
  const [roles, setRoles] = useState(initial)
  const [report, setReport] = useState<ResolveReport | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const run = () => start(async () => {
    setErr(null)
    const r = await resolveStorySpeakers(storyId)
    if ('error' in r) { setErr(r.error); return }
    setReport(r.report)
    const fresh = await listSpeakerRoles(storyId)
    if (!('error' in fresh)) setRoles(fresh.roles)
  })

  const drafts = roles.filter(r => r.status === 'ai_draft').length

  return (
    <section className="border border-ark-border p-4 mb-8">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] text-ark-text font-sans">指代解析</h2>
        <p className="text-[10px] text-ark-muted uppercase tracking-widest">
          {'// SPEAKER RESOLUTION'}
        </p>
        <span className="text-[10px] text-ark-muted">
          {'//'} {roles.length} 条 · 待确认 {drafts}
        </span>
        <button onClick={run} disabled={pending}
                className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                           hover:text-ark-accent-bright disabled:opacity-50">
          {'//'} {pending ? '运行中…' : '跑一批'}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ark-muted leading-relaxed font-sans">
        判断每个说话人标签在<b className="text-ark-text">本剧情里</b>指什么：
        具体人物／身份归属／关系指代／隐去姓名／非人物。
        「整合运动成员A」是<b className="text-ark-text">身份</b>，挂到组织「整合运动」上，
        自己不该成为一个节点；「女儿」是<b className="text-ark-text">关系指代</b>，
        指谁取决于这部剧情；「蒙面人」是<b className="text-ark-text">隐去姓名</b>，
        能判断出是谁就记下来并给出依据。
      </p>
      <p className="mt-2 text-[11px] text-ark-muted leading-relaxed font-sans">
        模型<b className="text-ark-text">只能引用给它看过的台词</b>，编造的引用会被丢弃；
        entity 必须逐字命中已有角色；依据不能为空。
        role 的组织名允许是新的，新建的组织会标成<b className="text-ark-text">待复核</b>。
        改任意一条就会把它记成你的判断（manual）。
      </p>

      {err && <p className="mt-3 text-[11px] text-ark-danger">{err}</p>}

      {report && (
        <div className="mt-3 text-[10px] text-ark-muted leading-relaxed">
          <p>
            {'//'} 本批询问 {report.asked} · 模型返回 {report.returned} ·
            写入 {report.written} · 还剩 {report.remaining}
            {report.createdOrgs.length > 0 && ` · 新建组织 ${report.createdOrgs.join('、')}`}
          </p>
          {report.unanchored.length > 0 && (
            <ul className="mt-1 pl-3 space-y-0.5">
              {report.unanchored.map((u, i) => (
                <li key={i} className="text-ark-accent/80">
                  「{u.speaker}」模型想挂靠到「{u.proposed}」，但标签里没有这个名字，
                  没有建为实体（判定已保留）
                </li>
              ))}
            </ul>
          )}
          {report.dropped.length > 0 && (
            <ul className="mt-1 pl-3 space-y-0.5">
              {report.dropped.map((d, i) => (
                <li key={i} className="text-ark-danger/80">
                  丢弃「{d.speaker}」：{d.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {roles.length > 0 && (
        <ul className="mt-4 space-y-2">
          {roles
            .slice()
            .sort((a, b) => Number(a.status !== 'ai_draft') - Number(b.status !== 'ai_draft'))
            .map(r => <RoleRow key={r.id} row={r} />)}
        </ul>
      )}
    </section>
  )
}

function RoleRow({ row }: { row: SpeakerRoleRow }) {
  const [state, setState] = useState(row)
  const [reason, setReason] = useState(row.reason)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const save = (patch: Parameters<typeof updateSpeakerRole>[1]) => start(async () => {
    setErr(null)
    const r = await updateSpeakerRole(state.id, patch)
    if ('error' in r) { setErr(r.error); return }
    setState(s => ({
      ...s, ...('kind' in patch ? { kind: patch.kind as RoleKind } : {}),
      ...('status' in patch ? { status: patch.status as SpeakerRoleRow['status'] } : {}),
      ...('reason' in patch ? { reason: patch.reason as string } : {}),
      source: 'manual',
    }))
  })

  const tone = state.status === 'confirmed' ? 'border-ark-success/40'
    : state.status === 'rejected' ? 'border-ark-danger/40'
      : 'border-ark-border'

  return (
    <li className={`border ${tone} p-2 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex items-baseline gap-2 flex-wrap text-[12px]">
        <span className="text-ark-text">{state.speaker}</span>
        <select value={state.kind} onChange={e => save({ kind: e.target.value as RoleKind })}
                disabled={pending}
                className="bg-ark-bg-2 border border-ark-border px-1 py-0.5 text-[10px] text-ark-text">
          {ROLE_KINDS.map(k => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
        </select>
        {state.entityName && (
          <span className="text-[10px] text-ark-accent">= {state.entityName}</span>
        )}
        {state.ofEntityName && (
          <span className="text-[10px] text-ark-muted">挂靠 {state.ofEntityName}</span>
        )}
        <span className="text-[9px] text-ark-muted uppercase tracking-widest">
          {state.source}
        </span>
        {state.sourceRefs.map(x => (
          <span key={x} className="text-[9px] text-ark-muted">{x}</span>
        ))}
        {state.status === 'ai_draft' && (
          <span className="ml-auto flex gap-2">
            <button onClick={() => save({ status: 'confirmed' })} disabled={pending}
                    className="text-[10px] uppercase tracking-widest px-2 py-0.5 border
                               border-ark-success/50 text-ark-success hover:bg-ark-success/10
                               disabled:opacity-50">
              确认
            </button>
            <button onClick={() => save({ status: 'rejected' })} disabled={pending}
                    className="text-[10px] uppercase tracking-widest px-2 py-0.5 border
                               border-ark-border text-ark-muted hover:border-ark-danger
                               hover:text-ark-danger disabled:opacity-50">
              驳回
            </button>
          </span>
        )}
        {state.status !== 'ai_draft' && (
          <span className="ml-auto text-[9px] uppercase tracking-widest text-ark-muted">
            {state.status === 'confirmed' ? '已确认' : '已驳回'}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input value={reason} onChange={e => setReason(e.target.value)}
               onBlur={() => reason !== state.reason && save({ reason })}
               className="flex-1 bg-transparent border-b border-ark-border/50 px-1 py-0.5
                          text-[11px] text-ark-muted focus:text-ark-text focus:outline-none" />
      </div>
      {err && <p className="mt-1 text-[10px] text-ark-danger">{err}</p>}
    </li>
  )
}

