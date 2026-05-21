'use client'

import { useState } from 'react'
import CommentThread from '@/components/CommentThread'

export interface OptionNode {
  id: number
  seq: number
  label: string | null
  description: string | null
  predicate: string | null
  note: string | null
  outcome: string | null
  commentCount: number
  options: OptionNode[]
}

/**
 * An event's decision tree. The intro narrative, then the top-level choices.
 * Picking a choice (DecisionBlock idiom — one open per level) reveals its
 * predicate / result / outcome, a comment thread anchored on that option
 * (event_option_id), and recursively its sub-choices.
 */
export default function EventTree({
  intro,
  options,
}: {
  intro: string | null
  options: OptionNode[]
}) {
  return (
    <div className="space-y-6">
      {intro && (
        <p className="text-sm leading-relaxed text-ark-muted whitespace-pre-wrap
                      border-l-2 border-ark-accent pl-4">
          {intro}
        </p>
      )}
      <OptionList options={options} depth={0} />
    </div>
  )
}

function OptionList({ options, depth }: { options: OptionNode[]; depth: number }) {
  const [picked, setPicked] = useState<number | null>(null)

  if (options.length === 0) {
    return depth === 0 ? (
      <p className="font-mono text-xs text-ark-muted tracking-widest">
        {'// no options recorded'}
      </p>
    ) : null
  }

  return (
    <ul className="space-y-1">
      {options.map((o, i) => {
        const active = picked === i
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => setPicked(p => (p === i ? null : i))}
              aria-expanded={active}
              className={`text-left text-sm transition-colors
                          ${active ? 'text-ark-accent' : 'text-ark-text hover:text-ark-accent'}`}
            >
              <span className="font-mono text-ark-accent mr-2">
                [{active ? '×' : i + 1}]
              </span>
              {o.label ?? <span className="text-ark-muted">{'(unnamed)'}</span>}
            </button>

            {active && (
              <div className="mt-2 mb-3 ml-4 pl-3 border-l border-ark-border space-y-2">
                {o.predicate && (
                  <p className="font-mono text-[10px] text-ark-accent tracking-widest
                                uppercase">
                    <span className="text-ark-border">{'//'}</span> 出现条件{' '}
                    <span className="text-ark-muted normal-case font-sans">
                      {o.predicate}
                    </span>
                  </p>
                )}
                {o.description && (
                  <p className="text-xs text-ark-accent leading-relaxed whitespace-pre-wrap">
                    {o.description}
                  </p>
                )}
                {o.outcome && (
                  <p className="text-sm text-ark-muted leading-relaxed whitespace-pre-wrap">
                    {o.outcome}
                  </p>
                )}
                {o.note && (
                  <p className="font-mono text-[10px] text-ark-muted tracking-widest">
                    <span className="text-ark-border">{'//'}</span> {o.note}
                  </p>
                )}

                <CommentThread
                  anchor={{ event_option_id: o.id }}
                  initialCount={o.commentCount}
                />

                {o.options.length > 0 && (
                  <OptionList options={o.options} depth={depth + 1} />
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
