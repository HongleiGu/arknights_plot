'use client'

import { useState } from 'react'
import { modRemoveComment, resolveReport, type ReportRow } from '@/app/actions/comments'

/**
 * Minimal mod queue (AP-4). Lists open reports; each can be resolved, or the
 * reported comment removed (which also resolves the report). Rows drop out of
 * the local list on success. All server-side actions are admin-gated by RLS.
 */
export default function ModReports({ initial }: { initial: ReportRow[] }) {
  const [rows, setRows] = useState<ReportRow[]>(initial)
  const [busyId, setBusyId] = useState<number | null>(null)

  function drop(id: number) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  async function onRemove(r: ReportRow) {
    if (!window.confirm('移除该评论并把此举报标记为已处理？')) return
    setBusyId(r.id)
    const a = await modRemoveComment(r.comment_id)
    if (a.ok) await resolveReport(r.id)
    setBusyId(null)
    if (a.ok) drop(r.id)
    else window.alert(a.error)
  }

  async function onResolve(r: ReportRow) {
    setBusyId(r.id)
    const a = await resolveReport(r.id)
    setBusyId(null)
    if (a.ok) drop(r.id)
    else window.alert(a.error)
  }

  if (rows.length === 0) {
    return (
      <p className="font-mono text-[10px] text-ark-border tracking-widest uppercase">
        {'// 队列为空'}
      </p>
    )
  }

  return (
    <ul className="space-y-4">
      {rows.map(r => {
        const stamp = new Date(r.created_at).toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        const busy = busyId === r.id
        return (
          <li key={r.id} className="border border-ark-border p-4 space-y-2">
            <p className="font-mono text-[10px] text-ark-muted tracking-widest">
              {'//'} 举报人 <span className="text-ark-accent">{r.reporter_name ?? 'anon'}</span>
              <span className="text-ark-border"> · </span>{stamp}
              <span className="text-ark-border"> · 评论作者 </span>
              <span className="text-ark-accent">{r.comment_author ?? 'anon'}</span>
            </p>

            {r.reason && (
              <p className="text-xs text-ark-muted">
                <span className="text-ark-border">理由：</span>{r.reason}
              </p>
            )}

            <div className="bg-ark-surface border-l-2 border-ark-border px-3 py-2 text-sm text-ark-text whitespace-pre-wrap">
              {r.comment_deleted
                ? <span className="font-mono text-[10px] italic text-ark-border tracking-widest">{'// [评论已删除]'}</span>
                : r.comment_body}
            </div>

            <div className="flex gap-4 pt-1">
              <button
                type="button"
                disabled={busy || r.comment_deleted}
                onClick={() => onRemove(r)}
                className="font-mono text-[10px] tracking-widest uppercase
                           text-ark-danger/80 hover:text-ark-danger
                           disabled:opacity-30 transition-colors"
              >
                {'//'} 移除评论 ⚠
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(r)}
                className="font-mono text-[10px] tracking-widest uppercase
                           text-ark-border hover:text-ark-accent
                           disabled:opacity-30 transition-colors"
              >
                {'//'} 标记已处理
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
