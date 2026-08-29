import Link from 'next/link'
import { isCurrentUserAdmin } from '@/app/actions/comments'

// Auth-dependent (reads cookies) → never static-render.
export const dynamic = 'force-dynamic'

const SECTIONS: { href: string; label: string; en: string; desc: string }[] = [
  {
    href: '/admin/ai',
    label: 'AI 控制台',
    en: 'AI CONSOLE',
    desc: '预算与计价、用户级访问、内容摘要生成、世界图谱关系抽取',
  },
  {
    href: '/mod',
    label: '审核',
    en: 'MODERATION',
    desc: '评论举报处理与下架',
  },
]

export default async function AdminIndexPage() {
  const admin = await isCurrentUserAdmin()

  if (!admin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="h-0.5 w-16 bg-ark-danger mb-8" />
        <h1 className="text-2xl font-light tracking-widest text-ark-text mb-2">访问受限</h1>
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
          {'// ADMIN · 需要管理员权限'}
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">管理台</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// ADMIN · '}{SECTIONS.length.toString().padStart(2, '0')}{' 个模块'}
      </p>

      <ul className="space-y-3">
        {SECTIONS.map(s => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block border border-ark-border p-4
                         hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors"
            >
              <p className="font-mono text-[10px] text-ark-accent tracking-widest uppercase mb-1">
                {'//'} {s.en}
              </p>
              <p className="text-sm text-ark-text">{s.label}</p>
              <p className="text-xs text-ark-muted mt-1">{s.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
