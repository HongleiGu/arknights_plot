'use client'

// Shared transcript model + renderer for the AI assistant.
//
// A conversation is a flat list of turns. An assistant turn is a sequence of
// interleaved parts — streamed text and tool-trace lines — so the UI reads
// like a real agent's terminal: search → fetch → read → answer.
//
// Both the live panel (components/Assistant.tsx) and a saved / shared session
// (/ai/[id], AP-20) render through here, so a shared link replays exactly what
// the person who ran it saw.

import CommentMarkdown from '@/components/CommentMarkdown'
import type { TurnInput } from '@/app/actions/conversations'

export type ToolPart = {
  kind: 'tool'
  name: string
  args: Record<string, unknown>
  summary?: string
  status: 'running' | 'done'
}
export type TextPart = { kind: 'text'; text: string }
export type Part = ToolPart | TextPart

export type Usage = { prompt: number; completion: number; total: number; cached: number; cost: number }

export type Turn =
  | { role: 'user'; text: string; author?: string | null }
  | {
      role: 'assistant'
      parts: Part[]
      error?: string
      streaming: boolean
      usage?: Usage
      truncated?: boolean
    }

const TOOL_LABEL: Record<string, string> = {
  search: 'SEARCH', read: 'READ', context_around: 'CONTEXT',
  list_boards: 'LIST_BOARDS', read_board: 'READ_BOARD',
  summary: 'SUMMARY', note: 'NOTE', recall: 'RECALL', memorize: 'MEMORIZE',
  search_entity: 'FIND_ENTITY', entity_graph: 'GRAPH', relate: 'RELATE',
  read_comments: 'COMMENTS', post_comment: 'POST_COMMENT',
  read_board_image: 'VIEW_IMAGE',
  create_board: 'NEW_BOARD', add_board_node: 'ADD_NODE',
  update_board_node: 'EDIT_NODE', delete_board_node: 'DEL_NODE',
  link_board_nodes: 'LINK',
}

// Tools that change data. Rendered in a warmer colour so a write is visible in
// the trace at a glance rather than blending into the retrieval steps.
const WRITE_TOOLS = new Set([
  'create_board', 'add_board_node', 'update_board_node', 'delete_board_node',
  'link_board_nodes', 'memorize', 'post_comment',
])

function argsPreview(args: Record<string, unknown>): string {
  return Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
}

/** Coerce a persisted `parts` JSON blob back into Part[], ignoring junk. */
export function partsFromJson(raw: unknown, fallbackText: string): Part[] {
  if (Array.isArray(raw)) {
    const parts = raw.filter((p): p is Part =>
      !!p && typeof p === 'object' &&
      ((p as Part).kind === 'text' || (p as Part).kind === 'tool'))
    if (parts.length) return parts
  }
  return fallbackText ? [{ kind: 'text', text: fallbackText }] : []
}

/** Turns → the persisted shape (AP-20). Assistant text is joined; trace kept. */
export function toTurnInputs(turns: Turn[]): TurnInput[] {
  return turns.map(t =>
    t.role === 'user'
      ? { role: 'user' as const, content: t.text }
      : {
          role: 'assistant' as const,
          content: t.parts.filter(p => p.kind === 'text').map(p => (p as TextPart).text).join(''),
          parts: t.parts,
          usage: t.usage ?? null,
        },
  )
}

export function ToolTrace({ part }: { part: ToolPart }) {
  const write = WRITE_TOOLS.has(part.name)
  return (
    <div className={`text-[11px] pl-2 border-l ${write ? 'border-ark-success/70' : 'border-ark-border/70'}`}>
      <div className={`flex items-center gap-1.5 ${write ? 'text-ark-success' : 'text-ark-accent/90'}`}>
        {part.status === 'running' ? <Spinner /> : <span className="text-ark-success">▸</span>}
        <span className="tracking-widest">{TOOL_LABEL[part.name] ?? part.name.toUpperCase()}</span>
        <span className="text-ark-muted truncate">{argsPreview(part.args)}</span>
      </div>
      {part.summary && (
        <div className="pl-4 text-ark-muted">
          {'└─'} {part.summary}
        </div>
      )}
    </div>
  )
}

export function Spinner() {
  return (
    <span className="inline-block w-2.5 h-2.5 border border-ark-accent/40 border-t-ark-accent rounded-full animate-spin" />
  )
}

/**
 * One turn. `onContinue` is supplied by the live panel so a truncated run can
 * be resumed; a read-only replay leaves it out and the button is hidden.
 */
export function TurnView({
  turn, onContinue, busy = false,
}: {
  turn: Turn
  onContinue?: () => void
  busy?: boolean
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex gap-2">
        <span className="text-ark-success shrink-0">{'>'}</span>
        <span className="text-ark-text whitespace-pre-wrap break-words">
          {turn.text}
          {turn.author && (
            <span className="ml-2 text-[10px] text-ark-border tracking-widest uppercase">
              {'// '}{turn.author}
            </span>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {turn.parts.map((p, j) =>
        p.kind === 'tool' ? (
          <ToolTrace key={j} part={p} />
        ) : (
          <div key={j} className="text-ark-text text-[13px] font-sans">
            <CommentMarkdown body={p.text} />
          </div>
        ),
      )}
      {turn.streaming && !turn.parts.some(p => p.kind === 'text') && (
        <div className="text-ark-muted flex items-center gap-1.5">
          <Spinner /> 思考中…
        </div>
      )}
      {turn.streaming && <span className="inline-block w-2 h-3.5 align-text-bottom bg-ark-accent animate-pulse" />}
      {turn.error && <div className="text-red-400">{'!!'} {turn.error}</div>}
      {!turn.streaming && turn.truncated && onContinue && (
        <button
          onClick={onContinue}
          disabled={busy}
          className="mt-1 px-2 py-0.5 border border-ark-accent text-ark-accent
                     hover:bg-ark-accent hover:text-ark-bg disabled:opacity-40
                     tracking-widest uppercase text-[10px] transition-colors"
        >
          继续调查 →
        </button>
      )}
      {!turn.streaming && turn.usage && turn.usage.total > 0 && (
        <div className="text-ark-border text-[10px] tracking-widest pt-0.5">
          {'//'} {turn.usage.total} tok
          {turn.usage.cached > 0 && <span className="text-ark-success"> · {turn.usage.cached} 缓存</span>}
          {turn.usage.cost > 0 && <span> · ${turn.usage.cost.toFixed(4)}</span>}
        </div>
      )}
    </div>
  )
}
