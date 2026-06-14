import Link from 'next/link'
import { isCurrentUserAdmin, listOpenReports } from '@/app/actions/comments'
import ModReports from './ModReports'

// Auth-dependent (reads cookies) → never static-render.
export const dynamic = 'force-dynamic'

export default async function ModPage() {
  const admin = await isCurrentUserAdmin()

  if (!admin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="h-0.5 w-16 bg-ark-danger mb-8" />
        <h1 className="text-2xl font-light tracking-widest text-ark-text mb-2">访问受限</h1>
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
          {'// MOD CONSOLE · 需要管理员权限'}
        </p>
        <Link
          href="/"
          className="inline-block mt-6 font-mono text-[10px] tracking-widest uppercase
                     text-ark-accent hover:text-ark-accent-bright transition-colors"
        >
          {'//'} ← 返回首页
        </Link>
      </div>
    )
  }

  const reports = await listOpenReports()

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">审核台</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// MOD CONSOLE · 举报队列 · '}{reports.length.toString().padStart(2, '0')}
      </p>
      <ModReports initial={reports} />
    </div>
  )
}
