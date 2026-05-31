import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ChapterCard from '@/components/ChapterCard'
import RelicSection, { type Relic } from '@/components/RelicSection'
import EventList, { type EventListItem } from '@/components/EventList'
import CharacterRecords, { type CharacterRecord } from '@/components/CharacterRecords'
import EndingSection, { type EndingSup } from '@/components/EndingSection'
import PersonnelFileSection, { type TextChunk } from '@/components/PersonnelFileSection'
import VoiceRecordSection from '@/components/VoiceRecordSection'
import FurnitureItemGrid, { type FurnitureItem } from '@/components/FurnitureItemGrid'

interface Props {
  params: Promise<{ category: string; story: string }>
}

const IS_CATEGORY = '集成战略'
const OP_CATEGORY = '干员'
const FU_CATEGORY = '家具'

// 集成战略 chapter level codes: one prologue (RO?-BEG) + N endings
// (RO?-END-n). 刻俄柏 has no theme digit (RO-BEG / RO-END-n) — \d* covers both.
const BEG_RE = /^RO\d*-BEG\b/
const END_RE = /^RO\d*-END\b/


export default async function StoryPage({ params }: Props) {
  const { category: encodedCategory, story: encodedStory } = await params
  const category = decodeURIComponent(encodedCategory)
  const storyName = decodeURIComponent(encodedStory)
  const isIS = category === IS_CATEGORY
  const isOp = category === OP_CATEGORY
  const isFurniture = category === FU_CATEGORY

  const supabase = await createClient()

  // Resolve the story row first; everything else hangs off its id.
  const { data: story, error: storyErr } = await supabase
    .from('stories')
    .select('id, name, description, arc')
    .eq('category', category)
    .eq('name', storyName)
    .maybeSingle()

  if (storyErr || !story) notFound()

  const { data: chapters, error: chErr } = await supabase
    .from('chapters')
    .select('id, level_code, level_name, stage, order_in_story')
    .eq('story_id', story.id)
    .order('order_in_story')

  // 干员: personnel file (008 kind=personnel_file) + voice records (kind=voice_record).
  let personnelFile: TextChunk[] = []
  let voiceRecords: TextChunk[] = []
  if (isOp) {
    const [{ data: pfCluster }, { data: vrCluster }] = await Promise.all([
      supabase
        .from('text_clusters')
        .select('text_chunks(id, seq, title, body)')
        .eq('story_id', story.id)
        .eq('kind', 'personnel_file')
        .maybeSingle(),
      supabase
        .from('text_clusters')
        .select('text_chunks(id, seq, title, body)')
        .eq('story_id', story.id)
        .eq('kind', 'voice_record')
        .maybeSingle(),
    ])
    personnelFile = (pfCluster?.text_chunks ?? []) as TextChunk[]
    voiceRecords  = (vrCluster?.text_chunks  ?? []) as TextChunk[]
  }

  // 家具: furniture_items (direct story_id FK; theme metadata stored per-item).
  let furnitureItems: FurnitureItem[] = []
  let furnitureMeta: { section: string; date_added: string | null; acquisition: string | null; atmo_total: number | null } | null = null
  if (isFurniture) {
    const { data: fi } = await supabase
      .from('furniture_items')
      .select('id, name, wiki_href, description, atmo_value, icon_sha1, seq, atmo_total, date_added, acquisition')
      .eq('story_id', story.id)
      .order('seq')
    furnitureItems = (fi ?? []) as FurnitureItem[]
    const first = (fi ?? [])[0] as (FurnitureItem & { atmo_total: number | null; date_added: string | null; acquisition: string | null }) | undefined
    furnitureMeta = {
      section:     story.arc ?? '',
      date_added:  first?.date_added ?? null,
      acquisition: first?.acquisition ?? null,
      atmo_total:  first?.atmo_total ?? null,
    }
  }

  // 集成战略 themes carry relics (006), events (007), supplementary text (008).
  let relics: Relic[] = []
  let events: EventListItem[] = []
  let charRecords: CharacterRecord[] = []
  let endingSups: EndingSup[] = []
  if (isIS) {
    const [{ data: g }, { data: e }, { data: cr }, { data: es }] = await Promise.all([
      supabase
        .from('gadgets')
        .select('id, kind, name, name_en, description, effect, icon_sha1, seq')
        .eq('story_id', story.id)
        .order('kind')
        .order('seq'),
      supabase
        .from('events')
        .select('id, category, name, name_en, intro, seq')
        .eq('story_id', story.id)
        .order('seq'),
      // character_record clusters (008)
      supabase
        .from('text_clusters')
        .select('id, title, title_en, seq, text_chunks(id, seq, title, body)')
        .eq('story_id', story.id)
        .eq('kind', 'character_record')
        .order('seq'),
      // ending_supplement clusters (008) — keyed by level_code
      supabase
        .from('text_clusters')
        .select('id, level_code, seq, image_sha1, text_chunks(id, seq, title, body)')
        .eq('story_id', story.id)
        .eq('kind', 'ending_supplement')
        .order('seq'),
    ])
    relics     = (g  ?? []) as Relic[]
    events     = (e  ?? []) as EventListItem[]
    charRecords = (cr ?? []) as CharacterRecord[]
    endingSups  = (es ?? []) as EndingSup[]
  }

  const chapterList = chapters ?? []

  if (chErr && !isIS && !isOp && !isFurniture) notFound()

  // ---------------------------------------------------------------------
  // 家具: theme metadata + individual pieces.
  // ---------------------------------------------------------------------
  if (isFurniture) {
    if (furnitureItems.length === 0 && !story.description) notFound()

    const sections: { key: string; cn: string; en: string }[] = [
      { key: 'pieces', cn: '家具', en: 'PIECES' },
    ]
    const aid = (key: string) => `sec-${key}`
    const num = (key: string) =>
      (sections.findIndex(s => s.key === key) + 1).toString().padStart(2, '0')

    return (
      <PageShell
        category={category}
        encodedCategory={encodedCategory}
        storyName={storyName}
        description={story.description}
        kicker="FURNITURE THEME"
      >
        {/* Metadata strip */}
        {furnitureMeta && (
          <div className="mb-10 flex flex-wrap gap-6 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
            {furnitureMeta.section && (
              <span>
                <span className="text-ark-accent">{'//'}</span>{' '}
                {furnitureMeta.section}
              </span>
            )}
            {furnitureMeta.atmo_total != null && (
              <span>
                <span className="text-ark-accent">{'//'}</span>{' '}
                ATM <span className="text-ark-text">{furnitureMeta.atmo_total}</span>
              </span>
            )}
            {furnitureMeta.date_added && (
              <span className="normal-case">{furnitureMeta.date_added}</span>
            )}
          </div>
        )}

        <FurnitureItemGrid
          items={furnitureItems}
          id={aid('pieces')}
          labelEn={`PIECES · ${num('pieces')}`}
          labelCn="家具"
        />
      </PageShell>
    )
  }

  // ---------------------------------------------------------------------
  // 干员: chapters (密录) + personnel file + voice records.
  // ---------------------------------------------------------------------
  if (isOp) {
    const hasContent = chapterList.length > 0 || personnelFile.length > 0 || voiceRecords.length > 0
    if (!hasContent) notFound()

    // Build section index (only sections with content, numbered in order).
    const opSections: { key: string; cn: string; en: string }[] = []
    if (chapterList.length)   opSections.push({ key: 'milv',  cn: '密录',   en: 'RECORDS'  })
    if (personnelFile.length) opSections.push({ key: 'file',  cn: '人员档案', en: 'FILE'    })
    if (voiceRecords.length)  opSections.push({ key: 'voice', cn: '语音记录', en: 'VOICE'   })

    const opAid = (key: string) => `sec-${key}`
    const opNum = (key: string) =>
      (opSections.findIndex(s => s.key === key) + 1).toString().padStart(2, '0')

    return (
      <PageShell
        category={category}
        encodedCategory={encodedCategory}
        storyName={storyName}
        description={story.description}
        kicker="OPERATOR"
      >
        {/* TOC bar — only shown when there is more than one section */}
        {opSections.length > 1 && (
          <nav
            className="sticky top-14 z-20 -mx-6 mb-12 border-y border-ark-border
                       bg-ark-bg/95 px-6 py-3 backdrop-blur"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] tracking-widest uppercase">
              <span className="text-ark-muted">[ INDEX ]</span>
              {opSections.map((s, i) => (
                <span key={s.key} className="flex items-center gap-4">
                  {i > 0 && <span className="text-ark-border">{'//'}</span>}
                  <a
                    href={`#${opAid(s.key)}`}
                    className="text-ark-muted hover:text-ark-accent transition-colors"
                  >
                    <span className="text-ark-accent">
                      {(i + 1).toString().padStart(2, '0')}
                    </span>{' '}
                    <span className="normal-case">{s.cn}</span>
                  </a>
                </span>
              ))}
            </div>
          </nav>
        )}

        {/* 密录 chapters */}
        {chapterList.length > 0 && (
          <Section
            id={opAid('milv')}
            num={opNum('milv')}
            cn="密录"
            en="RECORDS"
            count={chapterList.length}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {chapterList.map(chapter => (
                <ChapterCard
                  key={chapter.id}
                  category={category}
                  storyName={storyName}
                  chapter={chapter}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 人员档案 */}
        <PersonnelFileSection
          chunks={personnelFile}
          id={opAid('file')}
          num={opNum('file')}
        />

        {/* 语音记录 */}
        <VoiceRecordSection
          chunks={voiceRecords}
          id={opAid('voice')}
          num={opNum('voice')}
        />
      </PageShell>
    )
  }

  // ---------------------------------------------------------------------
  // Non-集成战略, non-干员: flat chapter index.
  // ---------------------------------------------------------------------
  if (!isIS) {
    if (chapterList.length === 0) notFound()
    return (
      <PageShell
        category={category}
        encodedCategory={encodedCategory}
        storyName={storyName}
        description={story.description}
        kicker="ARC"
      >
        <section>
          <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
            <span className="text-ark-accent">{'//'}</span>{' '}
            CHAPTERS{' '}
            <span className="text-ark-border">·</span>{' '}
            <span className="text-ark-text">
              {chapterList.length.toString().padStart(2, '0')}
            </span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {chapterList.map(chapter => (
              <ChapterCard
                key={chapter.id}
                category={category}
                storyName={storyName}
                chapter={chapter}
              />
            ))}
          </div>
        </section>
      </PageShell>
    )
  }

  // ---------------------------------------------------------------------
  // 集成战略: table-of-contents page.
  // ---------------------------------------------------------------------
  const code = (c: { level_code: string | null }) => c.level_code ?? ''
  const prologue = chapterList.filter(c => BEG_RE.test(code(c)))
  const endings = chapterList.filter(c => END_RE.test(code(c)))
  const otherChapters = chapterList.filter(
    c => !BEG_RE.test(code(c)) && !END_RE.test(code(c)),
  )

  // ending_supplement clusters keyed by level_code for O(1) lookup per ending.
  const supplementMap = new Map<string, EndingSup>(
    endingSups.filter(s => s.level_code).map(s => [s.level_code!, s])
  )

  // Sections present, in display order — drives both the TOC bar and the
  // section anchors. Numbered sequentially so absent ones don't leave gaps.
  // Order: prologue → endings (inline supplements) → characters → relics → events → special.
  const sections: { key: string; cn: string; en: string }[] = []
  if (prologue.length) sections.push({ key: 'prologue', cn: '序章', en: 'PROLOGUE' })
  if (endings.length) sections.push({ key: 'endings', cn: '结局', en: 'ENDINGS' })
  if (otherChapters.length) sections.push({ key: 'chapters', cn: '篇章', en: 'CHAPTERS' })
  if (charRecords.length) sections.push({ key: 'records', cn: '角色记录', en: 'RECORDS' })
  if (relics.length) sections.push({ key: 'relics', cn: '藏品', en: 'RELICS' })
  if (events.length) sections.push({ key: 'events', cn: '事件', en: 'EVENTS' })

  if (sections.length === 0) notFound()

  const aid = (key: string) => `sec-${key}`
  const num = (key: string) =>
    (sections.findIndex(s => s.key === key) + 1).toString().padStart(2, '0')

  return (
    <PageShell
      category={category}
      encodedCategory={encodedCategory}
      storyName={storyName}
      description={story.description}
      kicker="ROGUELIKE"
    >
      {/* TOC — sticky HUD anchor bar */}
      <nav
        className="sticky top-14 z-20 -mx-6 mb-12 border-y border-ark-border
                   bg-ark-bg/95 px-6 py-3 backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] tracking-widest uppercase">
          <span className="text-ark-muted">[ INDEX ]</span>
          {sections.map((s, i) => (
            <span key={s.key} className="flex items-center gap-4">
              {i > 0 && <span className="text-ark-border">{'//'}</span>}
              <a
                href={`#${aid(s.key)}`}
                className="text-ark-muted hover:text-ark-accent transition-colors"
              >
                <span className="text-ark-accent">
                  {(i + 1).toString().padStart(2, '0')}
                </span>{' '}
                <span className="normal-case">{s.cn}</span>
              </a>
            </span>
          ))}
        </div>
      </nav>

      {/* 序章 — the RO?-BEG framing chapter */}
      {prologue.length > 0 && (
        <Section id={aid('prologue')} num={num('prologue')} cn="序章" en="PROLOGUE" count={prologue.length}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {prologue.map(chapter => (
              <ChapterCard
                key={chapter.id}
                category={category}
                storyName={storyName}
                chapter={chapter}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 结局 — ending chapters with inline supplement text (008) */}
      <EndingSection
        endings={endings}
        supplementMap={supplementMap}
        category={category}
        storyName={storyName}
        id={aid('endings')}
        num={num('endings')}
      />

      {/* Any non-BEG/END chapters (rare for IS) — don't silently drop them. */}
      {otherChapters.length > 0 && (
        <Section id={aid('chapters')} num={num('chapters')} cn="篇章" en="CHAPTERS" count={otherChapters.length}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {otherChapters.map(chapter => (
              <ChapterCard
                key={chapter.id}
                category={category}
                storyName={storyName}
                chapter={chapter}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 角色记录 — per-character dossiers (008) */}
      <CharacterRecords records={charRecords} id={aid('records')} />

      {/* 藏品 — relic catalog (kind sub-grouped inside RelicSection) */}
      <RelicSection relics={relics} id={aid('relics')} />

      {/* 事件 — per-encounter decision trees (007) */}
      <EventList
        events={events}
        encodedCategory={encodedCategory}
        encodedStory={encodedStory}
        id={aid('events')}
      />
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Shared page shell — background, breadcrumb, title block.
// ---------------------------------------------------------------------------

function PageShell({
  category,
  encodedCategory,
  storyName,
  description,
  kicker,
  children,
}: {
  category: string
  encodedCategory: string
  storyName: string
  description: string | null
  kicker: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-ark-surface" />
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(to bottom, var(--ark-bg) 0%, transparent 30%, transparent 70%, var(--ark-bg) 100%)' }} />
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-16">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-10 font-mono text-[11px] text-ark-muted tracking-widest uppercase">
          <Link href="/" className="hover:text-ark-accent transition-colors">[ ROOT ]</Link>
          <span className="text-ark-border">{'//'}</span>
          <Link href={`/${encodedCategory}`} className="hover:text-ark-accent transition-colors">
            {category}
          </Link>
          <span className="text-ark-border">{'//'}</span>
          <span className="text-ark-accent normal-case">{storyName}</span>
        </div>

        {/* Title */}
        <div className="mb-12">
          <div className="h-0.5 w-8 bg-ark-accent mb-4" />
          <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-2">
            <span className="text-ark-accent">{'//'}</span> {kicker}
          </p>
          <h1 className="text-3xl font-thin tracking-widest text-ark-text">{storyName}</h1>
          {description && (
            <p className="mt-6 max-w-3xl border-l-2 border-ark-accent pl-4 text-sm leading-relaxed text-ark-muted">
              {description}
            </p>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline section header (chapters-style sections rendered by this page).
// Component-owned sections (RelicSection / EventList / CharacterRecords)
// render their own matching header.
// ---------------------------------------------------------------------------

function Section({
  id,
  num,
  cn,
  en,
  count,
  children,
}: {
  id: string
  num: string
  cn: string
  en: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-16 first:mt-0 scroll-mt-28">
      <div className="h-0.5 w-8 bg-ark-accent mb-4" />
      <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-6">
        <span className="text-ark-accent">{'//'}</span> {num}{' '}
        <span className="text-ark-border">·</span> {en}{' '}
        <span className="text-ark-border">·</span> {cn}{' '}
        <span className="text-ark-border">·</span>{' '}
        <span className="text-ark-text">
          {count.toString().padStart(2, '0')}
        </span>
      </p>
      {children}
    </section>
  )
}
