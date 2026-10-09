import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  listReviewQueue, reviewProgress,
} from '@/app/actions/entities'
import {
  IDENTITIES, IDENTITY_LABEL, type Identity, type Review,
} from '@/lib/graph'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import EntityReviewList from '@/components/EntityReviewList'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{
    identity?: string; review?: string; type?: string
    q?: string; min?: string; page?: string
  }>
}

const PER = 50

export default async function EntityReviewPage({ searchParams }: Props) {
  if (!(await isCurrentUserAdmin())) redirect('/')
  const sp = await searchParams

  const identity = (sp.identity ?? 'unverified') as Identity | 'all'
  const review = (sp.review ?? 'all') as Review | 'all'
  const minMentions = sp.min ? parseInt(sp.min, 10) : 20
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))

  const [queue, progress] = await Promise.all([
    listReviewQueue({
      identity, review, type: sp.type || undefined, q: sp.q || undefined,
      minMentions, limit: PER, offset: (page - 1) * PER,
    }),
    reviewProgress(),
  ])

  if ('error' in queue) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 font-mono text-[12px]">
        <p className="text-ark-danger">{queue.error}</p>
        <p className="mt-4 text-ark-muted text-[11px] leading-relaxed font-sans">
          如果提示 <code className="text-ark-text">identity</code> 或{' '}
          <code className="text-ark-text">review</code> 列不存在，说明迁移{' '}
          <code className="text-ark-text">044_graph_schema.sql</code> 还没应用——
          它需要在 Supabase SQL 编辑器里手动执行。
        </p>
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(queue.total / PER))
  const qs = (patch: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams()
    const merged = { identity, review, type: sp.type, q: sp.q, min: minMentions, page, ...patch }
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && v !== null) u.set(k, String(v))
    }
    return `/admin/entities?${u.toString()}`
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 font-mono text-[12px]">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1 font-sans">
        实体复核
      </h1>
      <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-6">
        {'// ENTITY REVIEW · IDENTITY & SUSPICIOUS QUEUE'}
      </p>

      <div className="text-[11px] text-ark-muted leading-relaxed mb-8 font-sans space-y-2">
        <p>
          6,889 个说话人被当成了 <code className="text-ark-text">character</code>，
          但其中大部分不是「一个人」。全部 715 个故事统计下来：
          <b className="text-ark-text">5,633 个只在一个故事里说过话</b>；
          而在 5 个以上故事里出现的 148 个非干员说话人，其实是三种东西混在一起——
        </p>
        <ul className="pl-4 space-y-1">
          <li>
            <b className="text-ark-text">具名</b>：塔露拉（17 个故事、1,605 行）、魏彦吾、特蕾西娅。
            真实人物，只是没有可操作的干员档案，合并成一个节点是对的。
          </li>
          <li>
            <b className="text-ark-text">泛指</b>：医疗干员（<b className="text-ark-text">44 个故事</b>）、
            罗德岛干员（28）、维多利亚士兵（11）。有名无姓的真人——一个节点其实是 44 个人，
            挂在上面的任何关系都是错的。
          </li>
          <li>
            <b className="text-ark-text">非人物</b>：众人（合声）、广播、门外的声音、
            父亲（每次都是不同的人）。根本不该是实体。
          </li>
        </ul>
        <p>
          这件事推导不出来，是对文本含义的判断，所以放在这里由人来做。做完之后，
          <code className="text-ark-text">044</code> 的触发器会拒绝把关系挂到
          「非人物」或仍待复核的节点上——批量抽取因此在物理上碰不到未判定的实体。
        </p>
        <p>
          放在这里而不是放进每个故事/章节里，是因为<b className="text-ark-text">判断的对象是实体，不是故事</b>：
          医疗干员出现在 44 个故事里，按故事做就要走 44 次、也就有 44 次做出不同判断的机会，
          而 5,633 个只出现一次的说话人永远排不出一个能干完的顺序。
          按故事看唯一的好处是上下文，所以上下文被搬到这里来了——点「证据」就能看到
          它在哪些故事里说话、各说了多少行、原话是什么。
        </p>
      </div>

      {!('error' in progress) && (
        <div className="flex gap-4 flex-wrap mb-6 text-[10px] uppercase tracking-widest">
          {IDENTITIES.map(i => (
            <span key={i} className="text-ark-muted">
              {IDENTITY_LABEL[i]}{' '}
              <b className="text-ark-text">{progress.byIdentity[i]?.toLocaleString() ?? 0}</b>
            </span>
          ))}
          <span className="text-ark-muted">
            待复核 <b className="text-ark-danger">{progress.suspicious.toLocaleString()}</b>
          </span>
        </div>
      )}

      {/* A plain form, server-rendered, like /world — no client JS for filters. */}
      <form action="/admin/entities" className="flex gap-2 flex-wrap items-end mb-6">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">判定</span>
          <select name="identity" defaultValue={identity}
                  className="bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text">
            <option value="all">全部</option>
            {IDENTITIES.map(i => <option key={i} value={i}>{IDENTITY_LABEL[i]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">复核</span>
          <select name="review" defaultValue={review}
                  className="bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text">
            <option value="all">全部</option>
            <option value="none">未标记</option>
            <option value="suspicious">待复核</option>
            <option value="reviewed">已复核</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">台词下限</span>
          <input name="min" type="number" min={0} defaultValue={minMentions}
                 className="w-24 bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] text-ark-muted uppercase tracking-widest">搜索</span>
          <input name="q" defaultValue={sp.q ?? ''} placeholder="名称"
                 className="bg-ark-bg-2 border border-ark-border px-2 py-1 text-ark-text" />
        </label>
        <button type="submit"
                className="border border-ark-accent-dim px-3 py-1 text-[10px] uppercase
                           tracking-widest text-ark-accent hover:bg-ark-accent/10">
          筛选
        </button>
      </form>

      <p className="text-[10px] text-ark-muted uppercase tracking-widest mb-3">
        {'//'} {queue.total.toLocaleString()} 条 · 第 {page}/{pages} 页 ·
        {' '}按台词数排序（影响大的先判）
      </p>

      <EntityReviewList rows={queue.rows} />

      <div className="flex gap-4 mt-6 text-[10px] uppercase tracking-widest">
        {page > 1 && (
          <Link href={qs({ page: page - 1 })} className="text-ark-accent hover:text-ark-accent-bright">
            {'//'} ← 上一页
          </Link>
        )}
        {page < pages && (
          <Link href={qs({ page: page + 1 })} className="text-ark-accent hover:text-ark-accent-bright">
            {'//'} 下一页 →
          </Link>
        )}
        <Link href="/admin" className="ml-auto text-ark-muted hover:text-ark-text">
          {'//'} ← 管理台
        </Link>
      </div>
    </div>
  )
}
