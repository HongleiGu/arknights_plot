import { notFound } from 'next/navigation'
import { getBoard } from '@/app/actions/boards'
import BoardEditor from './BoardEditor'

export const dynamic = 'force-dynamic'

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const board = await getBoard(parseInt(id, 10))
  if (!board) notFound()
  return <BoardEditor board={board} />
}
