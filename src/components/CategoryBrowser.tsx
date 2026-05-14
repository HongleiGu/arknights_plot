'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { storyImageUrl } from '@/lib/storage'

export interface BrowserStory {
  name: string
  description: string | null
  icon_sha1: string | null
  title_sha1: string | null
  cover_sha1: string | null
  count: number
}

interface Props {
  stories: BrowserStory[]
  category: string
  encodedCategory: string
}

// Pick the best available image for a story card. Icons come first because
// the 情报处理室 wiki provides them for events; covers/titles are the main
// story fallbacks.
// function bestImageUrl(s: BrowserStory, prefered?: string): string | null {
//   if (prefered === 'icon' && s.icon_sha1) return storyImageUrl('icon', s.icon_sha1)
//   if (prefered === 'cover' && s.cover_sha1) return storyImageUrl('cover', s.cover_sha1)
//   if (prefered === 'title' && s.title_sha1) return storyImageUrl('title', s.title_sha1)
//   return storyImageUrl('icon',  s.icon_sha1)
//       ?? storyImageUrl('cover', s.cover_sha1)
//       ?? storyImageUrl('title', s.title_sha1)
// }

export default function CategoryBrowser({ stories, category, encodedCategory }: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const active = stories[activeIdx]
  const imgUrl = active.cover_sha1 ?? active.title_sha1 ? storyImageUrl('cover', active.cover_sha1) ?? storyImageUrl('title', active.title_sha1) : null
  const total = stories.length
  const idx = (activeIdx + 1).toString().padStart(3, '0')
  const totalStr = total.toString().padStart(3, '0')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
      {/* ============================================================ */}
      {/* DISPLAYER  (left ~7/12 on desktop, full width on mobile)     */}
      {/* ============================================================ */}
      <div className="lg:col-span-7 lg:sticky lg:top-20 lg:self-start">
        {/* HUD frame */}
        <div className="relative">
          {/* Corner brackets */}
          <BracketCorner pos="tl" />
          <BracketCorner pos="tr" />
          <BracketCorner pos="bl" />
          <BracketCorner pos="br" />

          {/* Cover image */}
          <div className="relative aspect-[16/10] bg-ark-bg overflow-hidden border border-ark-border">
            {imgUrl ? (
              <Image
                key={active.name}  /* re-mount on change for fade-in */
                src={imgUrl}
                alt={active.name}
                fill
                sizes="(max-width:1024px) 100vw, 60vw"
                priority
                className="object-contain p-3 opacity-90 animate-[fadeIn_0.5s_ease-out]"
              />
            ) : (
              <div className="absolute inset-0 opacity-[0.08]"
                   style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 10px)' }} />
            )}

            {/* Top scanlines + gradient for ornament legibility */}
            <div className="absolute inset-0 pointer-events-none"
                 style={{ background: 'repeating-linear-gradient(180deg, transparent 0, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)' }} />
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ark-bg/90 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ark-bg/95 to-transparent pointer-events-none" />

            {/* Top-left readout */}
            <div className="absolute top-3 left-4 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
              <span className="text-ark-accent">{'//'}</span> RECORD <span className="text-ark-border">·</span>{' '}
              <span className="text-ark-accent-bright">{idx}</span>
              <span className="text-ark-border"> / {totalStr}</span>
            </div>

            {/* Top-right readout */}
            <div className="absolute top-3 right-4 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
              <span className="text-ark-success">●</span> AVAILABLE
            </div>

            {/* Big watermark index */}
            <div className="absolute bottom-2 right-3 pointer-events-none select-none">
              <span className="font-mono text-[80px] leading-none font-thin text-ark-text/8 tracking-tighter">
                {idx}
              </span>
            </div>
          </div>

          {/* Below-cover info plate */}
          <div className="mt-4 border-l-2 border-ark-accent pl-4">
            <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-1">
              <span className="text-ark-accent">{'//'}</span> ARC <span className="text-ark-border">·</span> {category}
            </p>
            <h2 className="text-3xl font-light tracking-wider text-ark-text mb-3">
              {active?.name ?? '—'}
            </h2>

            <p className="text-sm text-ark-muted leading-relaxed max-w-2xl">
              {active?.description ??
                <span className="font-mono text-[11px] tracking-widest uppercase text-ark-border">
                  {'// no description on file'}
                </span>
              }
            </p>

            {/* Metadata row */}
            <dl className="mt-5 grid grid-cols-3 gap-4 font-mono text-[10px] tracking-widest uppercase">
              <Metric label="CHAPTERS" value={active?.count.toString().padStart(2, '0') ?? '00'} />
              <Metric label="INDEX" value={idx} />
              <Metric label="STATUS" value="OPEN" />
            </dl>

            {/* CTA */}
            {active && (
              <Link
                href={`/${encodedCategory}/${encodeURIComponent(active.name)}`}
                className="inline-flex items-center gap-3 mt-6 px-5 py-2.5
                           border border-ark-accent text-ark-accent
                           font-mono text-xs tracking-[0.3em] uppercase
                           hover:bg-ark-accent hover:text-ark-bg
                           transition-colors duration-200 group"
              >
                <span>ENTER FILE</span>
                <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* CURVING LIST  (right ~5/12 on desktop, full width on mobile) */}
      {/* ============================================================ */}
      <div className="lg:col-span-5">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
          <span className="text-ark-accent">[</span>
          <span>OPERATION FILES</span>
          <span className="text-ark-accent">]</span>
          <span className="text-ark-border">{'//'}</span>
          <span>{totalStr}</span>
          <div className="flex-1 h-px bg-ark-border" />
        </div>

        {/* Perspective stage. On hover/focus, items rotate to face-on. */}
        <ul
          className="flex flex-col gap-1.5"
          style={{ perspective: '1400px', perspectiveOrigin: 'left center' }}
        >
          {stories.map((s, i) => {
            const isActive = i === activeIdx
            return (
              <li key={s.name}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onFocus={() => setActiveIdx(i)}
                  onClick={() => {
                    // Click = navigate. Second click on the same active item
                    // is the user confirming; useRouter would be cleaner but
                    // we route this through the displayer CTA which keeps a
                    // single canonical "navigate" path.
                    if (isActive) {
                      window.location.href = `/${encodedCategory}/${encodeURIComponent(s.name)}`
                    } else {
                      setActiveIdx(i)
                    }
                  }}
                  className={`group w-full text-left transition-all duration-400 ease-out
                              ${isActive ? 'translate-x-0' : 'translate-x-4 hover:translate-x-2'}`}
                  style={{
                    transform: isActive
                      ? 'rotateY(0deg)'
                      : 'rotateY(-18deg)',
                    transformOrigin: 'left center',
                  }}
                >
                  <DocStrip story={s} index={i} active={isActive} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Fade-in keyframes — scoped to this component via Tailwind arbitrary
          value didn't work cleanly so we drop a tiny style block. */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 0.9; }
        }
      `}</style>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Small subcomponents
// ---------------------------------------------------------------------------

function DocStrip({ story, index, active }: { story: BrowserStory; index: number; active: boolean }) {
  const imgUrl = story.icon_sha1 ?? storyImageUrl('icon', story.icon_sha1) ? storyImageUrl('icon', story.icon_sha1) : null
  const idx = (index + 1).toString().padStart(2, '0')
  return (
    <div
      className={`flex items-stretch gap-0 border h-16 overflow-hidden
                  ${active
                    ? 'border-ark-accent bg-ark-surface-2'
                    : 'border-ark-border bg-ark-surface group-hover:border-ark-accent-dim'}
                  transition-colors duration-200`}
    >
      {/* Index column */}
      <div className={`shrink-0 w-10 flex items-center justify-center font-mono text-[11px] tracking-widest
                       ${active ? 'text-ark-accent-bright' : 'text-ark-muted'}
                       border-r border-ark-border/60`}>
        {idx}
      </div>

      {/* Thumbnail */}
      <div className="relative w-14 shrink-0 bg-ark-bg">
        {imgUrl ? (
          <Image
            src={imgUrl}
            alt={story.name}
            fill
            sizes="112px"
            className={`object-contain p-1 transition-opacity duration-300 h-full
                        ${active ? 'opacity-100' : 'opacity-50 group-hover:opacity-75'}`}
          />
        ) : (
          <div className="absolute inset-0 opacity-[0.08]"
               style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 6px)' }} />
        )}
      </div>

      {/* Name + chapter count */}
      <div className="flex-1 min-w-0 flex flex-col justify-center px-3">
        <p className={`text-sm font-light truncate tracking-wide
                       ${active ? 'text-ark-accent-bright' : 'text-ark-text'}`}>
          {story.name}
        </p>
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mt-0.5">
          <span className="text-ark-accent">{'//'}</span> {story.count.toString().padStart(2, '0')} CH
        </p>
      </div>

      {/* Active indicator (right edge) */}
      <div className={`shrink-0 w-1 ${active ? 'bg-ark-accent' : 'bg-transparent'}`} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ark-muted">
        <span className="text-ark-accent">{'//'}</span> {label}
      </dt>
      <dd className="text-ark-text-bright text-base mt-1 font-light tracking-wider">{value}</dd>
    </div>
  )
}

function BracketCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  // Decorative `[ ]`-style corner brackets sitting just outside the image frame.
  const base = 'absolute w-3 h-3 border-ark-accent pointer-events-none'
  const map = {
    tl: '-top-1.5 -left-1.5 border-t border-l',
    tr: '-top-1.5 -right-1.5 border-t border-r',
    bl: '-bottom-1.5 -left-1.5 border-b border-l',
    br: '-bottom-1.5 -right-1.5 border-b border-r',
  }
  return <span className={`${base} ${map[pos]}`} aria-hidden />
}
