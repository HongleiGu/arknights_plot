'use client'

import { usePathname } from 'next/navigation'

/**
 * Persistent terminal-style status strip pinned to the viewport bottom.
 * Decorative — meant to read like an in-game HUD readout, not interactive.
 */
export default function StatusStrip() {
  const pathname = usePathname()
  const displayPath = pathname === '/' ? '/ROOT' : decodeURIComponent(pathname).toUpperCase()

  return (
    <div
      aria-hidden
      className="fixed bottom-0 left-0 right-0 z-40 h-7
                 bg-ark-bg/90 backdrop-blur-sm
                 border-t border-ark-border
                 font-mono text-[10px] text-ark-muted
                 flex items-center justify-between px-6
                 tracking-widest uppercase
                 pointer-events-none select-none"
    >
      {/* Left: terminal state */}
      <span className="flex items-center gap-2">
        <span className="text-ark-success">●</span>
        <span>TERMINAL ACTIVE</span>
        <span className="text-ark-border">{'//'}</span>
        <span className="text-ark-muted">RHODES IS.</span>
      </span>

      {/* Middle: current path */}
      <span className="hidden md:inline flex-1 text-center truncate px-4">
        <span className="text-ark-border">PATH</span>{' '}
        <span className="text-ark-accent">::</span>{' '}
        <span className="text-ark-muted normal-case tracking-wider">{displayPath}</span>
      </span>

      {/* Right: build / version */}
      <span className="flex items-center gap-2">
        <span>PRTS.RECORDS</span>
        <span className="text-ark-border">{'//'}</span>
        <span className="text-ark-muted">v0.1.0</span>
      </span>
    </div>
  )
}
