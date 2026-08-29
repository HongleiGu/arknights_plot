import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CommentThread from '@/components/CommentThread'
import DecisionBlock, { type BranchNode } from '@/components/DecisionBlock'
import { chapterSlug, parseChapterOrder } from '@/lib/chapterSlug'
import { boardBacklinks, type Backlink } from '@/app/actions/boards'

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

        {/* Node list */}
        <ol className="space-y-2">
          {nodeList.map(n => (
            <li key={n.id} className="group" id={`n${n.seq}`}>
              <NodeBody node={n} decision={decisionMap.get(n.id)} />
              <NodeBacklinks boards={backlinks[`node/${n.id}`]} />
              <CommentThread anchor={{ node_id: n.id }} initialCount={commentCounts.get(n.id) ?? 0} />
            </li>
          ))}
          {nodeList.length === 0 && (
            <li className="font-mono text-xs text-ark-muted tracking-widest">
              {'// no nodes on this page'}
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
    return (
      <div className="flex gap-3 py-1.5">
        {gutter}
        <p className="flex-1 font-mono text-[10px] text-ark-border tracking-widest uppercase">
          [ CG ]
        </p>
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
