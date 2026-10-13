import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  listReviewQueue, reviewProgress, listStoryReviewProgress, listStoryCast,
  listStoriesPlain,
} from '@/app/actions/entities'
import { IDENTITIES, IDENTITY_LABEL, type Identity, type Review } from '@/lib/graph'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import EntityReviewList from '@/components/EntityReviewList'
import StoryCastReview from '@/components/StoryCastReview'
import SpeakerRolePanel from '@/components/SpeakerRolePanel'
import SpeakerRoleCorpusPanel from '@/components/SpeakerRoleCorpusPanel'
import { listSpeakerRoles } from '@/app/actions/speakerRoles'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{
    story?: string; mode?: string; cat?: string
    identity?: string; review?: string; type?: string
    q?: string; min?: string; page?: string
  }>
}

const PER = 50

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 font-mono text-[12px]">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1 font-sans">
        实体复核
      </h1>
      <p className="text-[10px] text-ark-muted tracking-widest uppercase mb-6">
        {'// ENTITY REVIEW · PER STORY'}
      </p>
      {children}
    </div>
  )
}

export default async function EntityReviewPage({ searchParams }: Props) {
  if (!(await isCurrentUserAdmin())) redirect('/')
  const sp = await searchParams

  // ---- one story's cast -----------------------------------------------------
  if (sp.story) {
    const storyId = parseInt(sp.story, 10)
    const [r, rolesR] = await Promise.all([
      listStoryCast(storyId),
      listSpeakerRoles(storyId),
    ])
    if ('error' in r) {
      return <Shell><p className="text-ark-danger">{r.error}</p></Shell>
    }
    // 046 may not be applied yet; the cast review does not depend on it.
    const roles = 'error' in rolesR ? [] : rolesR.roles
    const rolesMissing = 'error' in rolesR ? rolesR.error : null
    const done = r.cast.filter(c => c.review === 'reviewed').length
    // A big story's cast is long — 反常光谱 has 154 speakers, eleven of them
    // mood-variants of 矿工 — so finished rows are hidden by default.
    const all = sp.mode === 'cast-all'
    const cast = all ? r.cast : r.cast.filter(c => c.review !== 'reviewed')
    return (
      <Shell>
        <div className="flex items-baseline gap-3 mb-4 flex-wrap">
          <h2 className="text-[15px] text-ark-text font-sans">{r.story}</h2>
          <span className="text-[10px] text-ark-muted uppercase tracking-widest">
            {'//'} {r.cast.length} 个说话人 · 已复核 {done} · 待办 {r.cast.length - done}
          </span>
          <Link href={`/admin/entities?story=${storyId}${all ? '' : '&mode=cast-all'}`}
                className="text-[10px] uppercase tracking-widest text-ark-accent
                           hover:text-ark-accent-bright">
            {'//'} {all ? '只看待办' : '显示全部'}
          </Link>
          <Link href="/admin/entities"
                className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                           hover:text-ark-accent-bright">
            {'//'} ← 换故事
          </Link>
        </div>
        <p className="text-[11px] text-ark-muted leading-relaxed mb-6 font-sans">
          在一个故事里判定，是为了<b className="text-ark-text">避开跨故事的同名巧合</b>：
          安娜不是薇薇安娜，瑟琳不是凯瑟琳——按名字相似度配对不会产生「不确定」，
          只会产生<b className="text-ark-text">自信的错误</b>。所以这里不提任何配对建议；
          「是谁的别名」的候选只来自<b className="text-ark-text">本故事的其他说话人</b>，
          由你选。判断所需的台词也只取本故事的。
        </p>
        {rolesMissing
          ? (
            <p className="border border-ark-border p-3 mb-8 text-[11px] text-ark-muted
                          leading-relaxed font-sans">
              {'//'} 指代解析不可用：{rolesMissing}。
              「整合运动成员A 其实是组织整合运动的成员」「这里的女儿是谁的女儿」这类判断
              需要它；下面的判定不受影响。
            </p>
          )
          : <SpeakerRolePanel storyId={storyId} initial={roles} />}

        <StoryCastReview cast={cast} roster={r.cast} />
      </Shell>
    )
  }

  // ---- the old global queue, kept as a secondary view -----------------------
  if (sp.mode === 'all') {
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
      return <Shell><p className="text-ark-danger">{queue.error}</p></Shell>
    }
    const pages = Math.max(1, Math.ceil(queue.total / PER))
    const qs = (patch: Record<string, string | number | undefined>) => {
      const u = new URLSearchParams()
      const merged = {
        mode: 'all', identity, review, type: sp.type, q: sp.q, min: minMentions, page, ...patch,
      }
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== '' && v !== null) u.set(k, String(v))
      }
      return `/admin/entities?${u.toString()}`
    }
    return (
      <Shell>
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="text-[15px] text-ark-text font-sans">全局列表</h2>
          <Link href="/admin/entities"
                className="ml-auto text-[10px] uppercase tracking-widest text-ark-accent
                           hover:text-ark-accent-bright">
            {'//'} ← 按故事复核
          </Link>
        </div>
        <p className="text-[11px] text-ark-muted leading-relaxed mb-6 font-sans">
          这是按影响排序的全局列表，用来快速处理台词最多的那些。
          真正需要上下文的判断请用<b className="text-ark-text">按故事复核</b>——
          跨故事比较名字会产生自信的错误。
        </p>
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
        <form action="/admin/entities" className="flex gap-2 flex-wrap items-end mb-6">
          <input type="hidden" name="mode" value="all" />
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
          {'//'} {queue.total.toLocaleString()} 条 · 第 {page}/{pages} 页
        </p>
        <EntityReviewList rows={queue.rows} />
        <div className="flex gap-4 mt-6 text-[10px] uppercase tracking-widest">
          {page > 1 && (
            <Link href={qs({ page: page - 1 })} className="text-ark-accent">{'//'} ← 上一页</Link>
          )}
          {page < pages && (
            <Link href={qs({ page: page + 1 })} className="text-ark-accent">{'//'} 下一页 →</Link>
          )}
        </div>
      </Shell>
    )
  }

  // ---- the work list: which stories still have unjudged speakers ------------
  const prog = await listStoryReviewProgress()

  // Without 045 the cast view still works — it runs on scope_speakers() (034) —
  // so the only thing missing is knowing which story to open. Fall back to a
  // plain list rather than blocking: 045 buys the per-story counts, not the
  // feature.
  if ('error' in prog && prog.missing) {
    const plain = await listStoriesPlain()
    if ('error' in plain) {
      return <Shell><p className="text-ark-danger">{plain.error}</p></Shell>
    }
    const list = sp.cat
      ? plain.stories.filter(s => s.category === sp.cat)
      : plain.stories
    const cs = [...new Set(plain.stories.map(s => s.category))]
    return (
      <Shell>
        <p className="text-[11px] text-ark-muted leading-relaxed mb-4 font-sans">
          迁移 <code className="text-ark-text">045_story_review_progress.sql</code>{' '}
          还没应用，所以这里<b className="text-ark-text">没有每个故事的待办数</b>。
          按故事复核本身不需要它——下面任选一个故事即可开始。
          应用 045 之后，这个列表会按「还有多少说话人没判定」排序，
          并且台词展开会用上 <code className="text-ark-text">nodes(speaker)</code> 索引
          （现在是对 414,720 行做全表扫描）。
        </p>
        <div className="flex gap-2 flex-wrap mb-4 text-[10px] uppercase tracking-widest">
          <Link href="/admin/entities"
                className={`px-2 py-1 border ${!sp.cat
                  ? 'border-ark-accent text-ark-accent' : 'border-ark-border text-ark-muted'}`}>
            全部
          </Link>
          {cs.map(c => (
            <Link key={c} href={`/admin/entities?cat=${encodeURIComponent(c)}`}
                  className={`px-2 py-1 border ${sp.cat === c
                    ? 'border-ark-accent text-ark-accent' : 'border-ark-border text-ark-muted'}`}>
              {c}
            </Link>
          ))}
          <Link href="/admin/entities?mode=all" className="ml-auto px-2 py-1 text-ark-accent">
            {'//'} 全局列表 →
          </Link>
        </div>
        <ul className="space-y-1">
          {list.slice(0, 300).map(s => (
            <li key={s.storyId}>
              <Link href={`/admin/entities?story=${s.storyId}`}
                    className="flex items-baseline gap-3 border border-ark-border px-3 py-2
                               hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors">
                <span className="text-[9px] text-ark-muted uppercase tracking-widest w-16 shrink-0">
                  {s.category}
                </span>
                <span className="text-[12px] text-ark-text truncate">{s.storyName}</span>
              </Link>
            </li>
          ))}
        </ul>
        {list.length > 300 && (
          <p className="mt-3 text-[10px] text-ark-muted">
            {'//'} 还有 {list.length - 300} 个故事，用上面的分类筛选
          </p>
        )}
      </Shell>
    )
  }
  if ('error' in prog) {
    return <Shell><p className="text-ark-danger">{prog.error}</p></Shell>
  }

  const cats = [...new Set(prog.progress.map(p => p.category))]
  const shown = sp.cat
    ? prog.progress.filter(p => p.category === sp.cat)
    : prog.progress
  const open = shown.filter(p => p.unresolved > 0)
  const totalOpen = prog.progress.reduce((n, p) => n + p.unresolved, 0)

  return (
    <Shell>
      <p className="text-[11px] text-ark-muted leading-relaxed mb-6 font-sans">
        每个故事里的说话人，在<b className="text-ark-text">那个故事里</b>判定：
        是具名人物、泛指身份、非人物，还是已有角色的别名。
        这样做是为了避开跨故事的同名巧合——安娜不是薇薇安娜，瑟琳不是凯瑟琳，
        按名字相似度配对不会产生「不确定」，只会产生自信的错误。
        判断所需的台词就在这个故事里。
      </p>

      <SpeakerRoleCorpusPanel />

      <div className="flex gap-3 flex-wrap items-baseline mb-4 text-[10px] uppercase tracking-widest">
        <span className="text-ark-muted">
          待办 <b className="text-ark-danger">{totalOpen.toLocaleString()}</b> 个说话人
          · <b className="text-ark-text">{open.length}</b> 个故事
        </span>
        <Link href="/admin/entities?mode=all"
              className="ml-auto text-ark-accent hover:text-ark-accent-bright">
          {'//'} 全局列表 →
        </Link>
      </div>

      <div className="flex gap-2 flex-wrap mb-6 text-[10px] uppercase tracking-widest">
        <Link href="/admin/entities"
              className={`px-2 py-1 border ${!sp.cat
                ? 'border-ark-accent text-ark-accent' : 'border-ark-border text-ark-muted'}`}>
          全部
        </Link>
        {cats.map(c => (
          <Link key={c} href={`/admin/entities?cat=${encodeURIComponent(c)}`}
                className={`px-2 py-1 border ${sp.cat === c
                  ? 'border-ark-accent text-ark-accent' : 'border-ark-border text-ark-muted'}`}>
            {c}
          </Link>
        ))}
      </div>

      <ul className="space-y-1">
        {shown.slice(0, 200).map(p => (
          <li key={p.storyId}>
            <Link href={`/admin/entities?story=${p.storyId}`}
                  className="flex items-baseline gap-3 border border-ark-border px-3 py-2
                             hover:border-ark-accent-dim hover:bg-ark-accent/5 transition-colors">
              <span className="text-[9px] text-ark-muted uppercase tracking-widest w-16 shrink-0">
                {p.category}
              </span>
              <span className="text-[12px] text-ark-text truncate">{p.storyName}</span>
              <span className="ml-auto text-[10px] text-ark-muted shrink-0">
                {p.speakers} 个说话人 · {p.lines.toLocaleString()} 行
              </span>
              <span className={`text-[10px] w-16 text-right shrink-0
                ${p.unresolved ? 'text-ark-danger' : 'text-ark-success'}`}>
                {p.unresolved ? `待办 ${p.unresolved}` : '已完成'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {shown.length > 200 && (
        <p className="mt-3 text-[10px] text-ark-muted">
          {'//'} 还有 {shown.length - 200} 个故事，用上面的分类筛选
        </p>
      )}
      <Link href="/admin" className="inline-block mt-6 text-[10px] uppercase tracking-widest
                                     text-ark-muted hover:text-ark-text">
        {'//'} ← 管理台
      </Link>
    </Shell>
  )
}
