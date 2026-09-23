import { redirect } from 'next/navigation'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import BookStructure from '@/components/BookStructure'

export const dynamic = 'force-dynamic'

export default async function BookStructurePage() {
  if (!(await isCurrentUserAdmin())) redirect('/')

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 font-mono text-[12px]">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1 font-sans">
        大地巡旅 · 结构
      </h1>
      <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-6">
        {'// BOOK STRUCTURE · CHAPTERS AND PRINTED PAGES'}
      </p>
      <p className="text-[11px] text-ark-muted leading-relaxed mb-8 font-sans">
        这本书的结构以数据库为准：<code className="text-ark-text">import_book.py</code>
        已不再重建它，因为正文是逐页校订的、章节是手工划分的，两者都不在
        <code className="text-ark-text">book_sections.json</code> 里。
        所以改章节名、挪页、删空章节都在这里做，而不是回到 SQL。
        段落文字仍在阅读页的「校订」里改。
      </p>
      <BookStructure />
    </div>
  )
}
