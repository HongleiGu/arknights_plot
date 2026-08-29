import Link from 'next/link'
import { listBoards, type BoardSummary } from '@/app/actions/boards'
import CreateBoard from './CreateBoard'

export const dynamic = 'force-dynamic'

const VIS_LABEL: Record<string, string> = {
  private: '私有', unlisted: '链接可见', public: '公开',
}

function BoardCard({ b }: { b: BoardSummary }) {
  return (
    <li>
      <Link
        href={`/boards/${b.id}`}
        className="block border border-ark-border p-4 hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors"
      >
        <p className="text-sm text-ark-text">{b.title}</p>
        {b.description && <p className="text-xs text-ark-muted mt-1 line-clamp-2">{b.description}</p>}
        <p className="font-mono text-[10px] text-ark-border tracking-widest uppercase mt-2">
          {'//'} {b.member_count} 节点
          {b.is_owner
            ? <span className="text-ark-muted"> · {VIS_LABEL[b.visibility] ?? b.visibility}</span>
            : <span className="text-ark-accent"> · {b.role === 'editor' ? '可编辑' : '可查看'}</span>}
        </p>
      </Link>
    </li>
  )
}

export default async function BoardsPage() {
  const boards = await listBoards()
  const mine = boards.filter(b => b.is_owner)
  const shared = boards.filter(b => !b.is_owner)

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">线索板</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// CLUE BOARDS · '}{boards.length.toString().padStart(2, '0')}
      </p>

      <CreateBoard />

      <section className="mt-8">
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
          {'//'} 我的 · {mine.length.toString().padStart(2, '0')}
        </p>
        <ul className="grid sm:grid-cols-2 gap-4">
          {mine.map(b => <BoardCard key={b.id} b={b} />)}
          {mine.length === 0 && (
            <li className="font-mono text-[10px] text-ark-border tracking-widest">{'// 还没有线索板'}</li>
          )}
        </ul>
      </section>

      {shared.length > 0 && (
        <section className="mt-10">
          <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
            {'//'} 共享给我 · {shared.length.toString().padStart(2, '0')}
          </p>
          <ul className="grid sm:grid-cols-2 gap-4">
            {shared.map(b => <BoardCard key={b.id} b={b} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
