'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { furnitureIconUrl } from '@/lib/storage'

export interface FurnitureTheme {
  id: number
  section: string
  name: string
  description: string | null
  date_added: string | null
  acquisition: string | null
  atmo_total: number | null
  icon_sha1: string | null
  seq: number
  count: number
}

const SECTION_LABEL: Record<string, { en: string; short: string }> = {
  '宿舍/活动室主题': { en: 'DORMITORY', short: '宿舍' },
  '会客室主题':     { en: 'MEETING ROOM', short: '会客室' },
  '散件':           { en: 'INDIVIDUAL', short: '散件' },
}

export default function FurnitureBrowser({ themes }: { themes: FurnitureTheme[] }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const active  = themes[activeIdx]
  const total   = themes.length
  const idx     = (activeIdx + 1).toString().padStart(3, '0')
  const totalStr = total.toString().padStart(3, '0')
  const iconUrl  = furnitureIconUrl(active?.icon_sha1)
  const sectionMeta = SECTION_LABEL[active?.section ?? ''] ?? { en: active?.section ?? '', short: '' }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
      {/* ================================================================ */}
      {/* DISPLAYER — left 7 / 12 on desktop                               */}
      {/* ================================================================ */}
      <div className="lg:col-span-7">
        <div className="relative">
          {/* Corner brackets */}
          <BracketCorner pos="tl" />
          <BracketCorner pos="tr" />
          <BracketCorner pos="bl" />
          <BracketCorner pos="br" />

          {/* Theme icon */}
          <div className="relative aspect-[4/3] shrink-0 bg-ark-bg overflow-hidden border border-ark-border">
            {iconUrl ? (
              <Image
                key={active.name}
                src={iconUrl}
                alt={active.name}
                fill
                sizes="(max-width:1024px) 100vw, 60vw"
                priority
                className="object-contain p-6 opacity-90 animate-[fadeIn_0.5s_ease-out]"
              />
            ) : (
              <div className="absolute inset-0 opacity-[0.08]"
                   style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 10px)' }} />
            )}

            <div className="absolute inset-0 pointer-events-none"
                 style={{ background: 'repeating-linear-gradient(180deg, transparent 0, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)' }} />
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ark-bg/90 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ark-bg/95 to-transparent pointer-events-none" />

            {/* Top-left readout */}
            <div className="absolute top-3 left-4 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
              <span className="text-ark-accent">{'//'}</span> FURNITURE <span className="text-ark-border">·</span>{' '}
              <span className="text-ark-accent-bright">{idx}</span>
              <span className="text-ark-border"> / {totalStr}</span>
            </div>

            {/* Top-right: section label */}
            <div className="absolute top-3 right-4 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
              <span className="text-ark-success">●</span> {sectionMeta.en}
            </div>

            {/* Watermark */}
            <div className="absolute bottom-2 right-3 pointer-events-none select-none">
              <span className="font-mono text-[80px] leading-none font-thin text-ark-text/[0.05] tracking-tighter">
                {idx}
              </span>
            </div>
          </div>

          {/* Info plate */}
          <div className="mt-4 border-l-2 border-ark-accent pl-4">
            <div className="gap-5 lg:flex">
              <div className="shrink-0 lg:w-56">
                <p className="font-mono text-[11px] text-ark-muted tracking-widest uppercase mb-0.5">
                  <span className="text-ark-accent">{'//'}</span> {sectionMeta.en}
                </p>
                {active?.section && (
                  <p className="font-mono text-[10px] text-ark-border mb-2">{active.section}</p>
                )}
                <h2 className="text-2xl font-light tracking-wider text-ark-text leading-tight">
                  {active?.name ?? '—'}
                </h2>
                {active?.date_added && (
                  <p className="font-mono text-[10px] text-ark-muted mt-2">{active.date_added}</p>
                )}
              </div>

              <p className="mt-4 text-sm text-ark-muted leading-relaxed lg:mt-0 lg:flex-1 lg:max-h-36 lg:overflow-y-auto lg:pr-3">
                {active?.description ?? (
                  <span className="font-mono text-[11px] tracking-widest uppercase text-ark-border">
                    {'// no description on file'}
                  </span>
                )}
              </p>
            </div>

            {/* Metadata row */}
            <dl className="mt-5 grid grid-cols-3 gap-4 font-mono text-[10px] tracking-widest uppercase">
              <Metric
                label="ATMOSPHERE"
                value={active?.atmo_total != null ? active.atmo_total.toString() : '—'}
              />
              <Metric label="INDEX" value={idx} />
              <Metric label="SECTION" value={sectionMeta.short || '—'} />
            </dl>

            {active?.acquisition && (
              <p className="mt-3 font-mono text-[10px] text-ark-muted tracking-widest">
                <span className="text-ark-accent">{'//'}</span> {active.acquisition.replace(/\n/g, ' · ')}
              </p>
            )}

            {/* CTA */}
            {active && (
              <Link
                href={`/家具/${encodeURIComponent(active.name)}`}
                className="inline-flex items-center gap-3 mt-5 px-5 py-2.5
                           border border-ark-accent text-ark-accent
                           font-mono text-xs tracking-[0.3em] uppercase
                           hover:bg-ark-accent hover:text-ark-bg
                           transition-colors duration-200 group"
              >
                <span>VIEW PIECES</span>
                <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* THEME LIST — right 5 / 12 on desktop                             */}
      {/* ================================================================ */}
      <div className="lg:col-span-5 lg:flex lg:flex-col lg:max-h-[calc(100vh-14rem)] lg:sticky lg:top-4">
        <div className="mb-3 flex shrink-0 items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-ark-muted">
          <span className="text-ark-accent">[</span>
          <span>THEME CATALOG</span>
          <span className="text-ark-accent">]</span>
          <span className="text-ark-border">{'//'}</span>
          <span>{totalStr}</span>
          <div className="flex-1 h-px bg-ark-border" />
        </div>

        <ul
          className="flex flex-col gap-1.5 lg:min-h-0 lg:overflow-y-auto lg:pr-2 lg:pb-4"
          style={{ perspective: '1400px', perspectiveOrigin: 'left center' }}
        >
          {themes.map((theme, i) => {
            const isActive  = i === activeIdx
            const prevTheme = themes[i - 1]
            const showDivider = i > 0 && theme.section !== prevTheme?.section
            return (
              <li key={theme.id}>
                {showDivider && (
                  <div className="flex items-center gap-2 font-mono text-[9px] tracking-widest uppercase text-ark-muted pt-3 pb-1.5 px-1">
                    <span className="text-ark-accent">{'//'}</span>
                    <span>{SECTION_LABEL[theme.section]?.en ?? theme.section}</span>
                    <div className="flex-1 h-px bg-ark-border" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={`group w-full text-left transition-all duration-300 ease-out
                              ${isActive ? 'translate-x-0' : 'translate-x-4 hover:translate-x-2'}`}
                  style={{
                    transform: isActive ? 'rotateY(0deg)' : 'rotateY(-18deg)',
                    transformOrigin: 'left center',
                  }}
                >
                  <ThemeStrip theme={theme} index={i} active={isActive} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

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
// Sub-components
// ---------------------------------------------------------------------------

function ThemeStrip({ theme, index, active }: {
  theme: FurnitureTheme; index: number; active: boolean
}) {
  const iconUrl = furnitureIconUrl(theme.icon_sha1)
  const idx     = (index + 1).toString().padStart(2, '0')
  return (
    <div className={`flex items-stretch gap-0 border h-14 overflow-hidden
                     ${active
                       ? 'border-ark-accent bg-ark-surface-2'
                       : 'border-ark-border bg-ark-surface group-hover:border-ark-accent-dim'}
                     transition-colors duration-200`}
    >
      {/* Index */}
      <div className={`shrink-0 w-10 flex items-center justify-center font-mono text-[11px] tracking-widest
                       ${active ? 'text-ark-accent-bright' : 'text-ark-muted'}
                       border-r border-ark-border/60`}>
        {idx}
      </div>

      {/* Thumbnail */}
      <div className="relative w-12 shrink-0 bg-ark-bg">
        {iconUrl ? (
          <Image
            src={iconUrl}
            alt={theme.name}
            fill
            sizes="48px"
            className={`object-contain p-1 transition-opacity duration-300
                        ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-65'}`}
          />
        ) : (
          <div className="absolute inset-0 opacity-[0.08]"
               style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--ark-accent) 0, var(--ark-accent) 1px, transparent 0, transparent 6px)' }} />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 flex flex-col justify-center px-3">
        <p className={`text-sm font-light truncate tracking-wide
                       ${active ? 'text-ark-accent-bright' : 'text-ark-text'}`}>
          {theme.name}
        </p>
        {theme.atmo_total != null && (
          <p className="font-mono text-[10px] text-ark-muted tracking-widest mt-0.5">
            <span className="text-ark-accent">{'//'}</span> ATM {theme.atmo_total}
          </p>
        )}
      </div>

      {/* Active indicator */}
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
      <dd className="text-ark-text text-base mt-1 font-light tracking-wider">{value}</dd>
    </div>
  )
}

function BracketCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'absolute w-3 h-3 border-ark-accent pointer-events-none'
  const map = {
    tl: '-top-1.5 -left-1.5 border-t border-l',
    tr: '-top-1.5 -right-1.5 border-t border-r',
    bl: '-bottom-1.5 -left-1.5 border-b border-l',
    br: '-bottom-1.5 -right-1.5 border-b border-r',
  }
  return <span className={`${base} ${map[pos]}`} aria-hidden />
}
