import { notFound } from 'next/navigation'
import { getConversation } from '@/app/actions/conversations'
import SessionView from './SessionView'

export const dynamic = 'force-dynamic'

export default async function AiSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  // RLS decides readability: a private session the caller has no share on comes
  // back null, which is a 404 — we don't distinguish "missing" from "forbidden".
  const convo = await getConversation(id)
  if (!convo) notFound()

  return <SessionView convo={convo} />
}
