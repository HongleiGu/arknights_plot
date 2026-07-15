import Link from 'next/link'
import { listBoards } from '@/app/actions/boards'
import CreateBoard from './CreateBoard'

export const dynamic = 'force-dynamic'

export default async function BoardsPage() {
  const boards = await listBoards()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">线索板</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// CLUE BOARDS · '}{boards.length.toString().padStart(2, '0')}
      </p>

      <CreateBoard />

      <ul className="mt-8 grid sm:grid-cols-2 gap-4">
        {boards.map(b => (
          <li key={b.id}>
            <Link
              href={`/boards/${b.id}`}
              className="block border border-ark-border p-4 hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors"
            >
              <p className="text-sm text-ark-text">{b.title}</p>
              {b.description && <p className="text-xs text-ark-muted mt-1 line-clamp-2">{b.description}</p>}
              <p className="font-mono text-[10px] text-ark-border tracking-widest uppercase mt-2">
                {'//'} {b.member_count} 节点
                {b.is_owner && <span className="text-ark-success"> · 我的</span>}
              </p>
            </Link>
          </li>
        ))}
        {boards.length === 0 && (
          <li className="font-mono text-[10px] text-ark-border tracking-widest">{'// 还没有线索板'}</li>
        )}
      </ul>
    </div>
  )
}
