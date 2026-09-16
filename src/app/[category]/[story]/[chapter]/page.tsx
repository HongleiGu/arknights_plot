import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CommentThread from '@/components/CommentThread'
import DecisionBlock, { type BranchNode } from '@/components/DecisionBlock'
import { chapterSlug, parseChapterOrder } from '@/lib/chapterSlug'
import { boardBacklinks, type Backlink } from '@/app/actions/boards'
import { createHash } from 'node:crypto'
import { bookImageUrl, bookPageUrl } from '@/lib/storage'
import PageScan from '@/components/PageScan'
import { isCurrentUserAdmin } from '@/app/actions/comments'
import BookPageEditor from '@/components/BookPageEditor'

const PAGE_SIZE = 100

type StageType = 'speech' | 'subtitle' | 'decision' | 'cgitem'

interface NodeRow {
  id:         number
  seq:        number
  type:       StageType
  speaker:    string | null
  content:    string | null
  raw_params: Record<string, unknown> | null
}

// Recover the file-side stage code (BEG / END / NBT / 剧情 / …) from the
// chapter's file_path, since the dedicated `stage` column is being phased
// out of the schema. Just for display chrome — not load-bearing.
function stageFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const m = path.match(/_([^_/\\]+)\.txt$/)
  return m ? m[1] : null
}

// Resolved per-decision view data: the option labels plus, parallel to them,
// the branch dialogue revealed when each option is chosen.
interface DecisionData {
  options:  string[]
  branches: BranchNode[][]
}

interface Props {
  params: Promise<{ category: string; story: string; chapter: string }>
  searchParams: Promise<{ page?: string }>
}


export default async function ChapterPage({ params, searchParams }: Props) {
  const { category: encCategory, story: encStory, chapter: chapterSeg } = await params
  const { page: pageStr } = await searchParams

  const category   = decodeURIComponent(encCategory)
  const storyName  = decodeURIComponent(encStory)
  const order      = parseChapterOrder(chapterSeg)
  const page       = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)

  if (Number.isNaN(order)) notFound()

  const supabase = await createClient()

  // ---- 1. Resolve story, then the chapter by its order within it ----
  // The URL segment is `<order_in_story>-<slug>` (see lib/chapterSlug); only the
  // leading order int is load-bearing, and the lookup is scoped to the
  // (category, name) story — so a chapter can't be reached under the wrong
  // story, and the slug tail is free to change without breaking links.
  const { data: story } = await supabase
    .from('stories')
    .select('id')
    .eq('category', category)
    .eq('name', storyName)
    .maybeSingle()

  if (!story) notFound()

  // `stage` is intentionally omitted — it's being phased out of the schema;
  // we recover the stage code from file_path for display.
  const { data: chapter, error: chErr } = await supabase
    .from('chapters')
    .select('id, story_id, level_code, level_name, file_path, order_in_story')
    .eq('story_id', story.id)
    .eq('order_in_story', order)
    .maybeSingle()

  if (chErr || !chapter) notFound()

  const chapterId = chapter.id

  // ---- 2. Total node count + paginated nodes ----
  // Branch dialogue now also lives in `nodes` (branch_id set); the linear
  // reading flow is only the main sequence, so exclude branch rows here.
  // They're fetched separately in step 3 and surfaced via DecisionBlock.
  const { count: totalNodes } = await supabase
    .from('nodes')
    .select('id', { count: 'exact', head: true })
    .eq('chapter_id', chapterId)
    .is('branch_id', null)

  const total      = totalNodes ?? 0
  const pageCount  = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage   = Math.min(page, pageCount)
  const offset     = (safePage - 1) * PAGE_SIZE

  const { data: nodes } = await supabase
    .from('nodes')
    .select('id, seq, type, speaker, content, raw_params')
    .eq('chapter_id', chapterId)
    .is('branch_id', null)
    .order('seq')
    .range(offset, offset + PAGE_SIZE - 1)

  const nodeList: NodeRow[] = (nodes ?? []) as NodeRow[]
  const nodeIds = nodeList.map(n => n.id)

  // Proofreading affordance for the settings book: an admin gets a per-page
  // editor inline with the text, so a correction is made while looking at the
  // paragraph rather than in a separate tool. Only asked for on that category —
  // this is an editorial surface, not a general feature.
  const isBook = category === '大地巡旅'
  const canEdit = isBook && await isCurrentUserAdmin()
  // First node of each printed page. Computed for ANY reader, not only an
  // admin: the scan toggle is public (the text is OCR and the plates are crops,
  // so the page's layout exists nowhere else), while the editor below it is
  // admin-only. One map, two consumers with different gates.
  const pageStarts = new Map<number, number>()   // node id -> printed page
  if (isBook) {
    const seen = new Set<number>()
    for (const n of nodeList) {
      const pg = (n.raw_params as { page?: number } | null)?.page
      if (pg != null && !seen.has(pg)) { seen.add(pg); pageStarts.set(n.id, pg) }
    }
  }
  // Consecutive `>> ` paragraphs are ONE inserted block, and the reader has to
  // show them as one. The left rule used to be drawn per paragraph, so a
  // block's own `// COMMENTS` affordances and the gap between list items
  // chopped it into pieces — the 14-paragraph letter in 1.3 天灾 read as 14
  // unrelated sidebars, and 15 of the book's 17 blocks are multi-paragraph.
  //
  // Adjacency IS the definition of a block: the editor format carries no block
  // id, and two blocks written back to back are indistinguishable from one
  // block of two paragraphs. A printed-page start also ends a run — the scan
  // toggle it renders is full width, and the block does continue on a new page.
  const nodeGroups: NodeRow[][] = []
  for (const n of nodeList) {
    const asideOf = (r: NodeRow) => !!(r.raw_params as { aside?: boolean } | null)?.aside
    const prev = nodeGroups[nodeGroups.length - 1]
    if (asideOf(n) && prev && asideOf(prev[0]) && !pageStarts.has(n.id)) prev.push(n)
    else nodeGroups.push([n])
  }
  // The asset key is the sha1 of the data/-relative path, so a page number is
  // enough — no lookup, and it resolves even for a page not yet uploaded
  // (the toggle then 404s on the image rather than the page failing to render).
  const scanUrl = (pg: number) => bookPageUrl(
    createHash('sha1').update(`book-pages/p${String(pg).padStart(4, '0')}.jpg`).digest('hex'))

  // ---- 3. Decision branch chain for decision nodes on this page ----
  // decisions → predicate_branches → branch rows in `nodes`. Branch
  // dialogue is mapped back onto the option that triggers it
  // (decisions.values[i] ↔ predicate_branches.predicates).
  const decisionMap = new Map<number, DecisionData>()
  const decisionNodeIds = nodeList.filter(n => n.type === 'decision').map(n => n.id)
  if (decisionNodeIds.length) {
    const { data: decs } = await supabase
      .from('decisions')
      .select('id, node_id, options, values')
      .in('node_id', decisionNodeIds)

    const decRows = (decs ?? []) as
      { id: number; node_id: number; options: string[]; values: string[] }[]

    if (decRows.length) {
      const decIds = decRows.map(d => d.id)
      const { data: pbs } = await supabase
        .from('predicate_branches')
        .select('id, decision_id, predicates, seq')
        .in('decision_id', decIds)
        .order('seq')
      const pbRows = (pbs ?? []) as
        { id: number; decision_id: number; predicates: string[]; seq: number }[]

      const branchNodesByBranch = new Map<number, BranchNode[]>()
      if (pbRows.length) {
        const { data: bns } = await supabase
          .from('nodes')
          .select('id, branch_id, seq, type, speaker, content')
          .in('branch_id', pbRows.map(p => p.id))
          .order('seq')
        type BranchRow = Omit<BranchNode, 'commentCount'> & { branch_id: number }
        for (const b of (bns ?? []) as BranchRow[]) {
          const arr = branchNodesByBranch.get(b.branch_id) ?? []
          arr.push({
            id: b.id, seq: b.seq, type: b.type,
            speaker: b.speaker, content: b.content,
            commentCount: 0,   // filled in step 4 once anchors are counted
          })
          branchNodesByBranch.set(b.branch_id, arr)
        }
      }

      const pbsByDecision = new Map<number, typeof pbRows>()
      for (const p of pbRows) {
        const arr = pbsByDecision.get(p.decision_id) ?? []
        arr.push(p)
        pbsByDecision.set(p.decision_id, arr)
      }

      for (const d of decRows) {
        const branchesForDecision = pbsByDecision.get(d.id) ?? []
        // value → that predicate branch's nodes (a branch can serve several values)
        const byValue = new Map<string, BranchNode[]>()
        for (const pb of branchesForDecision) {
          const nodes = branchNodesByBranch.get(pb.id) ?? []
          for (const pred of pb.predicates) byValue.set(pred.trim(), nodes)
        }
        // Map each option onto its branch by value; fall back to positional
        // (i-th branch by seq) when values are absent / mismatched.
        const branches: BranchNode[][] = d.options.map((_, i) => {
          const v = d.values[i]?.trim()
          return (v !== undefined && byValue.get(v))
            || branchNodesByBranch.get(branchesForDecision[i]?.id) || []
        })
        decisionMap.set(d.node_id, { options: d.options, branches })
      }
    }
  }

  // ---- 4. Per-node comment counts (one query, main + branch lines) ----
  // Branch lines are nodes too, so a single comment_anchors query over the
  // union of visible main ids and revealed-branch ids seeds every thread.
  const branchNodeIds: number[] = []
  for (const { branches } of decisionMap.values())
    for (const b of branches) for (const bn of b) branchNodeIds.push(bn.id)

  const commentCounts = new Map<number, number>()
  const anchorIds = [...nodeIds, ...branchNodeIds]
  if (anchorIds.length) {
    const { data: anchors } = await supabase
      .from('comment_anchors')
      .select('node_id')
      .in('node_id', anchorIds)
    for (const a of anchors ?? []) {
      commentCounts.set(a.node_id, (commentCounts.get(a.node_id) ?? 0) + 1)
    }
  }

  // Backfill the per-branch-line counts (objects are shared by reference
  // with decisionMap, so DecisionBlock sees the seeded values).
  for (const { branches } of decisionMap.values())
    for (const b of branches) for (const bn of b)
      bn.commentCount = commentCounts.get(bn.id) ?? 0

  // ---- 4b. Board backlinks (AP-13) ----
  // Which clue boards reference this chapter / story / any visible node.
  // Visibility-filtered inside the action (public + own + shared only).
  const backlinks = await boardBacklinks([
    { type: 'story', id: story.id },
    { type: 'chapter', id: chapterId },
    ...nodeIds.map(id => ({ type: 'node', id })),
  ])
  const chapterBacklinks = [
    ...(backlinks[`chapter/${chapterId}`] ?? []),
    ...(backlinks[`story/${story.id}`] ?? []),
  ]

  // ---- 5. Ending supplement (008) ----
  // Epilogue prose for an ending chapter (RO?-END-n), stored in text_clusters
  // (kind='ending_supplement') keyed by story_id + level_code. Belongs after
  // the whole narrative, so fetched + shown only on the last page.
  type SupChunk = { id: number; seq: number; title: string | null; body: string }
  const supplementChunks: SupChunk[] = []
  if (safePage === pageCount && chapter.level_code) {
    const { data: clusters } = await supabase
      .from('text_clusters')
      .select('seq, text_chunks(id, seq, title, body)')
      .eq('story_id', chapter.story_id)
      .eq('kind', 'ending_supplement')
      .eq('level_code', chapter.level_code)
      .order('seq')
    if (clusters) {
      // Flatten clusters (ordered by seq) → chunks (ordered by chunk.seq).
      const sorted = [...clusters].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      for (const cl of sorted) {
        const chunks = (cl.text_chunks as SupChunk[] ?? [])
          .sort((a, b) => a.seq - b.seq)
        supplementChunks.push(...chunks)
      }
    }
  }

  // ---- View helpers ----
  const encChapter = encodeURIComponent(chapterSlug(chapter)) // canonical segment for pager links
  const stage      = stageFromPath(chapter.file_path)
  const stageLabel = stage ? ` · ${stage}` : ''
  const levelLine  = [chapter.level_code, chapter.level_name].filter(Boolean).join(' ')
  const headerLine = levelLine + stageLabel || `chapter #${chapter.id}`

  return (
    <div className="min-h-[calc(100vh-3.5rem-1.75rem)] flex flex-col">
      {/* Faint background grid — same vibe as the other pages */}
      <div className="fixed inset-0 -z-10 bg-ark-bg">
        <div className="absolute inset-0 opacity-[0.025]"
             style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 font-mono text-[11px] text-ark-muted tracking-widest uppercase flex-wrap">
          <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encCategory}`} className="hover:text-ark-accent transition-colors">
            {category}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encCategory}/${encStory}`} className="hover:text-ark-accent transition-colors">
            {storyName}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <span className="text-ark-accent normal-case">{headerLine}</span>
        </div>

        {/* Title */}
        <div className="mb-8">
          <div className="h-0.5 w-8 bg-ark-accent mb-4" />
          <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
            <span className="text-ark-accent">{'//'}</span> CHAPTER
            {stage && <> <span className="text-ark-border">·</span> {stage}</>}
          </p>
          <h1 className="text-2xl sm:text-3xl font-light tracking-wider text-ark-text">
            {levelLine || `#${chapter.id}`}
          </h1>
          <p className="font-mono text-[10px] text-ark-muted mt-3 tracking-widest uppercase">
            <span className="text-ark-accent">{'//'}</span>{' '}
            <span className="text-ark-text">{total.toString().padStart(3, '0')}</span> NODES
            <span className="text-ark-border"> · </span>
            PAGE <span className="text-ark-text">{safePage.toString().padStart(2, '0')}</span>
            <span className="text-ark-border"> / </span>
            <span>{pageCount.toString().padStart(2, '0')}</span>
          </p>
          {chapterBacklinks.length > 0 && (
            <p className="font-mono text-[10px] text-ark-muted mt-2 tracking-widest uppercase flex items-center gap-2 flex-wrap">
              <span className="text-ark-accent">◇</span> 出现在
              {chapterBacklinks.map(b => (
                <Link key={b.board_id} href={`/boards/${b.board_id}`}
                      className="normal-case text-ark-accent/80 hover:text-ark-accent underline underline-offset-2">
                  {b.title}
                </Link>
              ))}
            </p>
          )}
        </div>

        {/* 大地巡旅 is machine-read from a scan, not a proofread edition. The
            note sits above the text rather than in a footer because a reader
            quoting a line needs to know before they quote it, not after. */}
        {category === '大地巡旅' && (
          <p className="border-l-2 border-ark-accent-dim bg-ark-surface/40 px-3 py-2 mb-6
                        text-xs text-ark-muted leading-relaxed">
            本篇由设定集扫描件 <strong className="text-ark-text font-normal">OCR</strong> 得到，
            可能存在识别错误（凯尔希的手写批注尤其容易出错），非官方校订版本。
            引用前请对照原书核对。
          </p>
        )}

        {/* Node list */}
        <ol className="space-y-2">
          {nodeGroups.map(group => {
            const items = group.map(n => (
              <li key={n.id} className="group" id={`n${n.seq}`}>
                {pageStarts.has(n.id) && (() => {
                  const pg = pageStarts.get(n.id)!
                  const url = scanUrl(pg)
                  return (
                    <>
                      {url && <PageScan src={url} label={`第 ${pg} 页`} />}
                      {canEdit && <BookPageEditor page={pg} />}
                    </>
                  )
                })()}
                <NodeBody node={n} decision={decisionMap.get(n.id)} />
                <NodeBacklinks boards={backlinks[`node/${n.id}`]} />
                <CommentThread anchor={{ node_id: n.id }} initialCount={commentCounts.get(n.id) ?? 0} />
              </li>
            ))
            if (!(group[0].raw_params as { aside?: boolean } | null)?.aside) return items
            // One rule for the whole block, drawn over the group rather than by
            // each paragraph, so nothing between the paragraphs can break it.
            // It is absolutely positioned at the column where the paragraphs
            // start — the gutter (w-12) plus the row's gap-3 plus the aside's
            // own 0.5rem inset — because the members are separate flex rows and
            // a border on any one of them can only ever be that row tall.
            return (
              <li key={`b${group[0].id}`} className="relative">
                <span aria-hidden
                      className="absolute top-1 bottom-1 left-17 w-0.5
                                 bg-ark-accent-dim/60" />
                <ol className="space-y-2">{items}</ol>
              </li>
            )
          })}
          {nodeList.length === 0 && (
            // A comic episode legitimately has no text yet — its 526 chapters
            // are metadata only until panel OCR lands (AP-33). Saying "no
            // nodes" there reads as a bug rather than as pending work.
            <li className="font-mono text-xs text-ark-muted tracking-widest">
              {category === '漫画' ? (
                <>
                  {'// 本篇为漫画，分镜文字尚未导入 · '}
                  <a href="https://terra-historicus.hypergryph.com/"
                     target="_blank" rel="noopener noreferrer"
                     className="text-ark-accent hover:underline">
                    前往泰拉记事社阅读 ↗
                  </a>
                </>
              ) : '// no nodes on this page'}
            </li>
          )}
        </ol>

        {/* Ending supplement — appended after the full narrative (008) */}
        {supplementChunks.length > 0 && (
          <section className="mt-12 border-t border-ark-border pt-8">
            <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-5">
              <span className="text-ark-accent">{'//'}</span> SUPPLEMENT{' '}
              <span className="text-ark-border">·</span> 补充档案{' '}
              <span className="text-ark-border">·</span>{' '}
              <span className="text-ark-text">
                {supplementChunks.length.toString().padStart(2, '0')}
              </span>
            </p>
            <div className="space-y-5">
              {supplementChunks.map((c, i) => (
                <div key={c.id} className="border-l-2 border-ark-accent/40 pl-4">
                  {c.title ? (
                    <p className="font-mono text-[10px] text-ark-accent tracking-widest mb-1.5">
                      {c.title}
                    </p>
                  ) : (
                    <p className="font-mono text-[10px] text-ark-border tracking-widest mb-1.5">
                      <span className="text-ark-accent">{'//'}</span>{' '}
                      {(i + 1).toString().padStart(2, '0')}
                    </p>
                  )}
                  <p className="text-sm leading-relaxed text-ark-text/90 whitespace-pre-wrap">
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pagination footer */}
        {pageCount > 1 && (
          <nav className="mt-12 flex items-center justify-between font-mono text-[11px] tracking-widest uppercase">
            <PagerLink
              href={safePage > 1
                ? `/${encCategory}/${encStory}/${encChapter}?page=${safePage - 1}`
                : null}
              label="← PREV"
            />
            <span className="text-ark-muted">
              <span className="text-ark-text">{safePage.toString().padStart(2, '0')}</span>
              <span className="text-ark-border"> / </span>
              <span>{pageCount.toString().padStart(2, '0')}</span>
            </span>
            <PagerLink
              href={safePage < pageCount
                ? `/${encCategory}/${encStory}/${encChapter}?page=${safePage + 1}`
                : null}
              label="NEXT →"
            />
          </nav>
        )}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Per-node board backlinks (AP-13) — a subtle chip aligned to the node gutter;
// hovering reveals the boards that reference this line.
// ---------------------------------------------------------------------------

function NodeBacklinks({ boards }: { boards?: Backlink[] }) {
  if (!boards || boards.length === 0) return null
  return (
    // 3.75rem = gutter w-12 (3rem) + gap-3 (0.75rem), so the chip lines up
    // under the node content rather than the line-number gutter.
    <div className="pl-15">
      <span className="relative inline-block group/bl align-baseline">
        <span className="font-mono text-[10px] text-ark-accent/70 tracking-widest cursor-default hover:text-ark-accent">
          ◇ {boards.length} 板
        </span>
        <span
          className="pointer-events-none group-hover/bl:pointer-events-auto
                     invisible opacity-0 group-hover/bl:visible group-hover/bl:opacity-100
                     absolute left-0 top-full z-30 mt-1 w-56 p-2
                     bg-ark-bg border border-ark-border shadow-2xl transition-opacity"
        >
          <span className="block font-mono text-[9px] text-ark-muted tracking-widest uppercase mb-1">
            {'//'} 出现在
          </span>
          {boards.map(b => (
            <Link key={b.board_id} href={`/boards/${b.board_id}`}
                  className="block text-xs text-ark-text hover:text-ark-accent truncate py-0.5">
              {b.title}
            </Link>
          ))}
        </span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Node body renderer (server component — no interactivity)
// ---------------------------------------------------------------------------

function NodeBody({ node, decision }: { node: NodeRow; decision?: DecisionData }) {
  const seqPad = node.seq.toString().padStart(4, '0')

  // Tiny line-number gutter that's persistent across types
  const gutter = (
    <span className="shrink-0 w-12 font-mono text-[10px] text-ark-border tracking-widest pt-1 select-none">
      {seqPad}
    </span>
  )

  // A book heading (raw_params.level 1-5). Stored since the first import and
  // rendered as ordinary prose until now, so all 698 of them read as body text.
  // Falls back to the pre-existing `heading` boolean so the 698 already in the
  // database render without waiting for a re-import.
  const rp = node.raw_params as {
    level?: number; heading?: boolean; aside?: boolean
  } | null
  const level = rp?.level ?? (rp?.heading ? 1 : 0)

  // Everything belonging to an inserted block — its prose, its headings and its
  // plates — carries the same indent, so the reader can see where the block
  // starts and ends without the parts being styled as main-flow content. A
  // heading or an illustration inside a block is not an exception to it.
  //
  // Indent only: the rule is drawn once over the whole block by the node list,
  // not here. A border on a paragraph can only be that paragraph tall, which is
  // what made a block of several paragraphs read as several separate blocks.
  // 1.25rem keeps the text exactly where the old `ml-2 pl-3` put it, and the
  // list positions the rule to match.
  const isAside = !!rp?.aside
  const ASIDE = 'pl-5'

  if (level && node.content) {
    // Sizes step down rather than mapping to h1-h5 semantics: the section
    // title is already the page's h1, so these are all subordinate to it.
    // Inside a block the whole scale drops, since the block's prose is text-xs
    // and an ordinary text-lg heading there would out-rank the section itself.
    const cls = isAside
      ? (level <= 1 ? 'text-sm text-ark-text' : 'text-xs text-ark-text')
      : [
          'text-lg text-ark-text',
          'text-base text-ark-text',
          'text-sm text-ark-text',
          'text-sm text-ark-muted',
          'text-xs text-ark-muted',
        ][Math.min(level, 5) - 1]
    return (
      <div className={`flex gap-3 ${isAside ? 'pt-3 pb-0.5' : 'pt-4 pb-1'}`}>
        {gutter}
        <h3 className={`flex-1 font-medium tracking-wide ${cls} ${isAside ? ASIDE : ''}`}>
          {node.content}
        </h3>
      </div>
    )
  }

  // An inserted block (`>> ` in the editor): a pull quote, sidebar or terminal
  // transcript that sits beside the prose rather than in its flow. Indented,
  // ruled and set smaller so the eye can skip it and rejoin the paragraph after.
  // Must precede the subtitle branch — book text is subtitle nodes, so a later
  // check never runs (the heading renderer hit exactly that).
  if (isAside && node.content) {
    return (
      <div className="flex gap-3 py-1">
        {gutter}
        <aside className={`flex-1 ${ASIDE} text-xs text-ark-muted
                           leading-relaxed whitespace-pre-line`}>
          {node.content}
        </aside>
      </div>
    )
  }

  if (node.type === 'subtitle') {
    return (
      <div className="flex gap-3 py-1.5">
        {gutter}
        <p className="flex-1 italic text-center text-ark-muted text-sm tracking-wide">
          {node.content}
        </p>
      </div>
    )
  }

  if (node.type === 'decision') {
    return (
      <DecisionBlock
        seq={node.seq}
        options={decision?.options ?? []}
        branches={decision?.branches ?? []}
      />
    )
  }

  if (node.type === 'cgitem') {
    // 大地巡旅 plates carry an image_sha1 in raw_params (cropped from the scan
    // by mineru_book.py). AVG cgitem rows don't, and keep the placeholder —
    // there is no asset behind those.
    const ip = node.raw_params as {
      image_sha1?: string; image_sha1s?: string[]; page?: number
      caption?: string; captions?: (string | null)[]
    } | null
    // A row of plates sharing one printed caption arrives as several sha1s on
    // one node, so the caption is rendered once under the row rather than
    // repeated per image.
    const sha1s = ip?.image_sha1s?.length ? ip.image_sha1s
                : (ip?.image_sha1 ? [ip.image_sha1] : [])
    const page = ip?.page
    // One caption sits under the whole row; N captions label each plate.
    const perImage = (ip?.captions?.length ?? 0) > 1 ? ip!.captions! : null
    const caption = perImage ? null : ip?.caption
    const srcs = sha1s.map(bookImageUrl).filter((u): u is string => !!u)
    return (
      <div className="flex gap-3 py-1.5">
        {gutter}
        {srcs.length ? (
          // A plate inside an inserted block takes the block's indent and rule,
          // and is capped in width: a full-bleed illustration reads as a plate
          // of the main text, which is exactly the confusion `>> ` exists to
          // prevent. Same treatment as the block's prose, so the two group.
          <figure className={`flex-1 my-2 ${isAside ? `${ASIDE} max-w-md` : ''}`}>
            {/* One grid row of N equal columns rather than a wrapping flex
                row: with `flex-wrap` a run of four plates broke onto a second
                line, which is not how the page prints them. minmax(0,1fr) is
                what lets the columns actually shrink — `1fr` alone floors at
                the image's intrinsic width and overflows instead. */}
            <div className={srcs.length > 1 ? 'grid gap-2 items-end' : ''}
                 style={srcs.length > 1
                   ? { gridTemplateColumns: `repeat(${srcs.length}, minmax(0, 1fr))` }
                   : undefined}>
              {srcs.map((src, i) => (
                <span key={src} className={srcs.length > 1 ? 'flex flex-col gap-1 min-w-0' : ''}>
                  {/* Plain <img>: these are arbitrary-aspect crops from a scan,
                      and next/image would need a width/height we don't store. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src}
                       alt={perImage?.[i] || (page
                         ? `插图 · 第 ${page} 页${srcs.length > 1 ? ` (${i + 1}/${srcs.length})` : ''}`
                         : '插图')}
                       loading="lazy"
                       className={`border border-ark-border bg-ark-surface ${
                         srcs.length > 1 ? 'w-full h-auto' : 'max-w-full'}`} />
                  {perImage?.[i] && (
                    <span className="block text-xs text-ark-muted leading-relaxed">
                      {perImage[i]!.split(/\n\s*\n/).map((para, k) => (
                        <span key={k} className="block whitespace-pre-line">{para}</span>
                      ))}
                    </span>
                  )}
                </span>
              ))}
            </div>
            {(caption || page) && (
              <figcaption className="mt-1">
                {caption && caption.split(/\n\s*\n/).map((para, k) => (
                  // A caption may be several paragraphs; whitespace-pre-line
                  // keeps the single line breaks inside one of them.
                  <span key={k} className="block text-xs text-ark-muted leading-relaxed whitespace-pre-line">
                    {para}
                  </span>
                ))}
                {page && (
                  <span className="block font-mono text-[10px] text-ark-border tracking-widest">
                    {'// P'}{page}{srcs.length > 1 ? ` · ${srcs.length} 图` : ''}
                  </span>
                )}
              </figcaption>
            )}
          </figure>
        ) : (
          <p className="flex-1 font-mono text-[10px] text-ark-border tracking-widest uppercase">
            [ CG ]
          </p>
        )}
      </div>
    )
  }

  // type === 'speech'
  const isNarrator = node.speaker === 'narrator' || !node.speaker
  return (
    <div className="flex gap-3 py-1">
      {gutter}
      <div className="flex-1">
        {!isNarrator && (
          <span className="inline-block font-mono text-[11px] text-ark-accent tracking-widest uppercase mr-2 align-baseline">
            {node.speaker}
          </span>
        )}
        <span className={isNarrator
          ? 'text-ark-muted text-sm leading-relaxed'
          : 'text-ark-text text-sm leading-relaxed'}>
          {node.content}
        </span>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Pagination link — disabled state when href is null
// ---------------------------------------------------------------------------

function PagerLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return <span className="text-ark-border">{label}</span>
  }
  return (
    <Link href={href} className="text-ark-muted hover:text-ark-accent transition-colors">
      {label}
    </Link>
  )
}
