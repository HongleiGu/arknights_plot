'use client'

// Toggle the original scanned page beside the transcribed text.
//
// Not admin-gated: the text is OCR and the plates are crops, so neither
// carries the page's layout, and some information only exists there — a
// table's alignment, which caption belongs to which plate, 凯尔希's
// handwriting sitting next to the paragraph it argues with. A reader checking
// a surprising sentence needs the same affordance a proofreader does.
//
// Collapsed by default, and the <img> is only mounted once opened, so a
// hundred-page chapter costs nothing until someone asks for a page. Written to
// take any image URL rather than a book page specifically, so AP-33 can mount
// the same component for comic panels.

import { useState } from 'react'

export default function PageScan({
  src, label, side = true,
}: {
  src: string
  /** What the button names, e.g. "第 11 页". */
  label: string
  /** Float it beside the text (default) rather than full width. */
  side?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={open && side ? 'lg:float-right lg:ml-4 lg:w-2/5 my-2' : 'my-2'}>
      <button
        onClick={() => setOpen(o => !o)}
        className="font-mono text-[10px] tracking-widest uppercase px-2 py-1
                   border border-ark-border text-ark-muted
                   hover:text-ark-accent hover:border-ark-accent-dim transition-colors"
        aria-expanded={open}
      >
        {open ? `收起原页 · ${label}` : `原页 · ${label}`}
      </button>
      {open && (
        <figure className="mt-2">
          {/* Plain <img>: a scan has no width/height we store, and next/image
              would need them. Loading is deferred to the click, so this is
              never on the critical path. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`扫描原页 · ${label}`} loading="lazy"
               className="w-full border border-ark-border bg-ark-surface" />
          <figcaption className="font-mono text-[10px] text-ark-border tracking-widest mt-1">
            {'// SCAN · '}{label}
            <a href={src} target="_blank" rel="noopener noreferrer"
               className="ml-2 text-ark-muted hover:text-ark-accent">原图 ↗</a>
          </figcaption>
        </figure>
      )}
    </div>
  )
}
