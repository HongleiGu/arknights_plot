import Link from 'next/link'
import { listConversations, type ConversationSummary } from '@/app/actions/conversations'

export const dynamic = 'force-dynamic'

const VIS_LABEL: Record<string, string> = {
  private: '私有', unlisted: '链接可见', public: '公开',
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function SessionCard({ c }: { c: ConversationSummary }) {
  return (
    <li>
      <Link
        href={`/ai/${c.id}`}
        className="block border border-ark-border p-4 hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors"
      >
        <p className="text-sm text-ark-text line-clamp-2">{c.title}</p>
        <p className="font-mono text-[10px] text-ark-border tracking-widest uppercase mt-2">
          {'//'} {c.turn_count} 条 · {when(c.updated_at)}
          {c.is_owner
            ? <span className="text-ark-muted"> · {VIS_LABEL[c.visibility] ?? c.visibility}</span>
            : <span className="text-ark-accent"> · {c.role === 'editor' ? '可继续提问' : '可查看'}</span>}
        </p>
      </Link>
    </li>
  )
}

export default async function AiSessionsPage() {
  const sessions = await listConversations()
  const mine = sessions.filter(c => c.is_owner)
  const shared = sessions.filter(c => !c.is_owner)

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">AI 会话</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// AI SESSIONS · '}{sessions.length.toString().padStart(2, '0')}
      </p>

      <p className="font-mono text-[11px] text-ark-muted mb-8">
        {'//'} 在右下角的分析终端里提问，点「保存」即可存为会话并共享给其他人。
      </p>

      <section>
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
          {'//'} 我的 · {mine.length.toString().padStart(2, '0')}
        </p>
        <ul className="grid sm:grid-cols-2 gap-4">
          {mine.map(c => <SessionCard key={c.id} c={c} />)}
          {mine.length === 0 && (
            <li className="font-mono text-[10px] text-ark-border tracking-widest">{'// 还没有保存的会话'}</li>
          )}
        </ul>
      </section>

      {shared.length > 0 && (
        <section className="mt-10">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
            {'//'} 共享给我 · {shared.length.toString().padStart(2, '0')}
          </p>
          <ul className="grid sm:grid-cols-2 gap-4">
            {shared.map(c => <SessionCard key={c.id} c={c} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
