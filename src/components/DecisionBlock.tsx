'use client'

import { useState } from 'react'
import CommentThread from '@/components/CommentThread'

export interface BranchNode {
  id:           number
  seq:          number
  type:         'speech' | 'subtitle' | 'cgitem'
  speaker:      string | null
  content:      string | null
  commentCount: number
}

interface Props {
  /** main-sequence seq of the decision node, for the gutter */
  seq:      number
  options:  string[]
  /** parallel to `options` — the branch dialogue revealed when option i is picked */
  branches: BranchNode[][]
}

/**
 * Decision node. By default nothing below the option list is shown; clicking
 * an option reveals that predicate branch's dialogue (click again to collapse).
 * Only one branch is open at a time — matches how the choice plays out in-game.
 */
export default function DecisionBlock({ seq, options, branches }: Props) {
  const [picked, setPicked] = useState<number | null>(null)
  const seqPad = seq.toString().padStart(4, '0')

  return (
    <div className="flex gap-3 py-2">
      <span className="shrink-0 w-12 font-mono text-[10px] text-ark-border tracking-widest pt-1 select-none">
        {seqPad}
      </span>

      <div className="flex-1 border-l-2 border-ark-accent pl-3">
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-1.5">
          <span className="text-ark-accent">{'//'}</span> DECISION
          {picked !== null && (
            <span className="text-ark-border"> · BRANCH {(picked + 1).toString().padStart(2, '0')}</span>
          )}
        </p>

        {options.length === 0 ? (
          <p className="text-xs text-ark-muted">{'// no options recorded'}</p>
        ) : (
          <ul className="space-y-1">
            {options.map((opt, i) => {
              const active = picked === i
              return (
                <li key={i}>
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
                    {opt}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {picked !== null && (
          <div className="mt-3 pl-3 border-l border-ark-border space-y-1">
            {branches[picked]?.length ? (
              branches[picked].map(bn => (
                <div key={bn.id}>
                  <BranchLine node={bn} />
                  <CommentThread anchor={{ node_id: bn.id }} initialCount={bn.commentCount} />
                </div>
              ))
            ) : (
              <p className="font-mono text-[10px] text-ark-border tracking-widest">
                {'// no dialogue recorded for this choice'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BranchLine({ node }: { node: BranchNode }) {
  const seqPad = node.seq.toString().padStart(2, '0')
  const gutter = (
    <span className="shrink-0 w-8 font-mono text-[10px] text-ark-border tracking-widest pt-0.5 select-none">
      ↳{seqPad}
    </span>
  )

  if (node.type === 'subtitle') {
    return (
      <div className="flex gap-3 py-0.5">
        {gutter}
        <p className="flex-1 italic text-center text-ark-muted text-sm tracking-wide">
          {node.content}
        </p>
      </div>
    )
  }

  if (node.type === 'cgitem') {
    return (
      <div className="flex gap-3 py-0.5">
        {gutter}
        <p className="flex-1 font-mono text-[10px] text-ark-border tracking-widest uppercase">
          [ CG ]
        </p>
      </div>
    )
  }

  // speech
  const isNarrator = node.speaker === 'narrator' || !node.speaker
  return (
    <div className="flex gap-3 py-0.5">
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
