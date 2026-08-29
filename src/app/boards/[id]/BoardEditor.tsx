'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SearchAdd from './SearchAdd'
import SharePanel from './SharePanel'
import {
  addCardMember,
  addEdge as addEdgeAction,
  deleteEdge as deleteEdgeAction,
  deleteMember,
  updateBoard,
  updateEdge,
  updateMember,
  type Board,
  type BoardEdge,
  type BoardMember,
} from '@/app/actions/boards'

// Preset relationship vocabulary for typed edges (AP-14). `kind` is stored as
// free text; this table only drives styling + the editor picker. NULL / unknown
// kind → the neutral 'relates' look.
const EDGE_KINDS: { key: string; label: string; color: string; dashed?: boolean }[] = [
  { key: 'relates',     label: '关联',    color: '#585858' },
  { key: 'causes',      label: '导致',    color: '#18d1ff' },
  { key: 'contradicts', label: '矛盾',    color: '#ff5555', dashed: true },
  { key: 'same',        label: '同一人',  color: '#b98cff' },
  { key: 'allied',      label: '同盟',    color: '#8fc31f' },
  { key: 'opposed',     label: '敌对',    color: '#ff9955' },
]
const KIND_SPEC = (kind: string | null) => EDGE_KINDS.find(k => k.key === kind) ?? EDGE_KINDS[0]

// A stored BoardEdge → a styled React Flow edge. Kind drives stroke colour /
// dash / arrow; data carries the raw fields so the editor can round-trip them.
function edgeToRF(e: BoardEdge): Edge {
  const spec = KIND_SPEC(e.kind)
  const kindLabel = spec.key === 'relates' ? '' : spec.label
  const label = [kindLabel, e.label].filter(Boolean).join(' · ')
  return {
    id: String(e.id),
    source: String(e.from),
    target: String(e.to),
    label: label || undefined,
    data: { kind: e.kind, directed: e.directed, rawLabel: e.label },
    style: { stroke: spec.color, strokeDasharray: spec.dashed ? '6 4' : undefined },
    labelStyle: { fill: spec.color, fontSize: 10 },
    markerEnd: e.directed ? { type: MarkerType.ArrowClosed, color: spec.color } : undefined,
  }
}

const TYPE_ICON: Record<string, string> = {
  story: '◈', chapter: '§', node: '¶', gadget: '◆',
  event: '❖', option: '▸', text: '✎', furniture: '⌂',
}

interface NodeData extends Record<string, unknown> {
  member: BoardMember
  canEdit: boolean
  onEditCard: (id: number) => void
}

function memberToNode(m: BoardMember, canEdit: boolean, onEditCard: (id: number) => void): Node<NodeData> {
  return {
    id: String(m.id),
    type: m.kind,
    position: { x: m.x, y: m.y },
    draggable: canEdit,
    data: { member: m, canEdit, onEditCard },
  }
}

// ---- custom nodes ----

function EntityNode({ data }: NodeProps<Node<NodeData>>) {
  const { ref } = data.member
  return (
    <div className="w-56 bg-ark-surface border border-ark-accent/40 rounded shadow-lg text-xs">
      <Handle type="target" position={Position.Left} className="!bg-ark-accent" />
      <Handle type="source" position={Position.Right} className="!bg-ark-accent" />
      <div className="px-2 py-1 border-b border-ark-border font-mono text-[10px] text-ark-accent tracking-widest uppercase">
        {TYPE_ICON[ref?.type ?? ''] ?? '◇'} {ref?.type ?? 'entity'}
      </div>
      <div className="p-2">
        <p className="text-ark-text font-medium">{ref?.label ?? `#${data.member.id}`}</p>
        {ref?.preview && <p className="text-ark-muted mt-1 line-clamp-3 leading-relaxed">{ref.preview}</p>}
        {ref?.href && (
          <a href={ref.href} target="_blank" rel="noreferrer"
             className="nodrag block mt-1.5 font-mono text-[10px] text-ark-accent hover:text-ark-accent-bright tracking-widest">
            打开 →
          </a>
        )}
      </div>
    </div>
  )
}

function CardNode({ data }: NodeProps<Node<NodeData>>) {
  const { member, canEdit, onEditCard } = data
  return (
    <div
      onDoubleClick={() => canEdit && onEditCard(member.id)}
      className="w-48 min-h-12 bg-ark-accent/10 border border-ark-accent/40 rounded shadow-lg p-2 text-xs"
      title={canEdit ? '双击编辑' : undefined}
    >
      <Handle type="target" position={Position.Left} className="!bg-ark-accent" />
      <Handle type="source" position={Position.Right} className="!bg-ark-accent" />
      {member.title && <p className="text-ark-accent font-medium mb-1">{member.title}</p>}
      <p className="text-ark-text whitespace-pre-wrap leading-relaxed">{member.note}</p>
    </div>
  )
}

const nodeTypes = { entity: EntityNode, card: CardNode }

// ---- editor ----

export default function BoardEditor({ board }: { board: Board }) {
  const isOwner = board.is_owner
  const canEdit = board.can_edit

  const onEditCard = useCallback((id: number) => {
    setNodes(ns => {
      const n = ns.find(x => x.id === String(id))
      const current = (n?.data.member.note as string) ?? ''
      const next = window.prompt('卡片内容', current)
      if (next == null) return ns
      void updateMember(id, { note: next })
      return ns.map(x =>
        x.id === String(id) ? { ...x, data: { ...x.data, member: { ...x.data.member, note: next } } } : x,
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(
    board.members.map(m => memberToNode(m, canEdit, onEditCard)),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(board.edges.map(edgeToRF))
  const [layout, setLayout] = useState(board.layout)
  const [msg, setMsg] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // The edge currently open in the typed-edge editor panel.
  const [selEdge, setSelEdge] = useState<{ id: number; kind: string | null; label: string | null; directed: boolean } | null>(null)

  // Persist a node's position after a drag.
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    if (!canEdit || layout === 'timeline') return
    void updateMember(Number(node.id), { x: node.position.x, y: node.position.y })
  }, [canEdit, layout])

  // Connect two nodes → an edge.
  const onConnect = useCallback((c: Connection) => {
    if (!canEdit || !c.source || !c.target) return
    void addEdgeAction(board.id, Number(c.source), Number(c.target)).then(res => {
      if (res.ok) setEdges(eds => [...eds, edgeToRF(res.edge)])
    })
  }, [canEdit, board.id, setEdges])

  // Persist a change to the selected edge and restyle it in place.
  const patchEdge = useCallback((id: number, patch: Partial<Pick<BoardEdge, 'kind' | 'label' | 'directed'>>) => {
    setEdges(eds => eds.map(x => {
      if (x.id !== String(id)) return x
      const d = (x.data ?? {}) as { kind?: string | null; directed?: boolean; rawLabel?: string | null }
      return edgeToRF({
        id,
        from: Number(x.source),
        to: Number(x.target),
        kind: patch.kind !== undefined ? patch.kind : d.kind ?? null,
        label: patch.label !== undefined ? patch.label : d.rawLabel ?? null,
        directed: patch.directed !== undefined ? patch.directed : d.directed ?? false,
      })
    }))
    setSelEdge(s => (s && s.id === id ? { ...s, ...patch } : s))
    void updateEdge(id, patch)
  }, [setEdges])

  const onEdgeClick = useCallback((_e: unknown, edge: Edge) => {
    if (!canEdit) return
    const d = (edge.data ?? {}) as { kind?: string | null; directed?: boolean; rawLabel?: string | null }
    setSelEdge({ id: Number(edge.id), kind: d.kind ?? null, label: d.rawLabel ?? null, directed: !!d.directed })
  }, [canEdit])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (!canEdit) return
    for (const n of deleted) void deleteMember(Number(n.id))
  }, [canEdit])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!canEdit) return
    for (const e of deleted) void deleteEdgeAction(Number(e.id))
  }, [canEdit])

  async function addCard() {
    const text = window.prompt('卡片内容')
    if (text == null || !text.trim()) return
    const res = await addCardMember(board.id, text)
    if (!res.ok) { setMsg(res.error); return }
    setNodes(ns => [...ns, memberToNode(res.member, canEdit, onEditCard)])
  }

  function toggleLayout() {
    const next = layout === 'timeline' ? 'board' : 'timeline'
    setLayout(next)
    // Layout is board meta → only the owner can persist it (RLS); editors get a
    // local-only view toggle.
    if (isOwner) void updateBoard(board.id, { layout: next })
    if (next === 'timeline') {
      // Lay nodes out left-to-right by seq, then by current x.
      setNodes(ns => {
        const ordered = [...ns].sort((a, b) =>
          (a.data.member.seq - b.data.member.seq) || (a.position.x - b.position.x))
        const xOf = new Map(ordered.map((n, i) => [n.id, i * 260 + 40]))
        return ns.map(n => ({ ...n, position: { x: xOf.get(n.id) ?? n.position.x, y: 120 } }))
      })
    } else {
      // Restore stored board positions.
      setNodes(ns => ns.map(n => ({ ...n, position: { x: n.data.member.x, y: n.data.member.y } })))
    }
  }

  return (
    <div className="h-[calc(100vh-3.5rem-1.75rem)] flex flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-ark-border bg-ark-bg/90 flex-wrap">
        <Link href="/boards" className="font-mono text-[10px] tracking-widest uppercase text-ark-border hover:text-ark-accent transition-colors">
          {'//'} ← 线索板
        </Link>
        <span className="text-sm text-ark-text">{board.title}</span>
        {board.my_role && board.my_role !== 'owner' && (
          <span className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">
            {board.my_role === 'editor' ? '协作者' : '只读'}
          </span>
        )}
        {!canEdit && board.my_role == null && (
          <span className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">只读</span>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {canEdit && (
            <>
              <SearchAdd
                boardId={board.id}
                onAdded={m => setNodes(ns => [...ns, memberToNode(m, canEdit, onEditCard)])}
              />
              <button onClick={addCard} className="font-mono text-[10px] tracking-widest uppercase px-2 py-1 border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim transition-colors">
                + 卡片
              </button>
            </>
          )}
          <button onClick={toggleLayout} className="font-mono text-[10px] tracking-widest uppercase px-2 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
            {layout === 'timeline' ? '板视图' : '时间线'}
          </button>
          {isOwner && (
            <button onClick={() => setShareOpen(true)} className="font-mono text-[10px] tracking-widest uppercase px-2 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
              共享
            </button>
          )}
        </div>
        {msg && <span className="w-full font-mono text-[10px] text-ark-danger tracking-widest">{'// ' + msg}</span>}
      </div>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => setSelEdge(null)}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          nodesDraggable={canEdit && layout !== 'timeline'}
          nodesConnectable={canEdit}
          elementsSelectable={canEdit}
          deleteKeyCode={canEdit ? 'Delete' : null}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-ark-bg"
        >
          <Background color="#1d1f20" gap={24} />
          <Controls className="!bg-ark-surface !border-ark-border" />
          {canEdit && selEdge && (
            <Panel position="bottom-right">
              <EdgeEditor
                key={selEdge.id}
                sel={selEdge}
                onKind={k => patchEdge(selEdge.id, { kind: k })}
                onLabel={l => patchEdge(selEdge.id, { label: l })}
                onDirected={d => patchEdge(selEdge.id, { directed: d })}
                onDelete={() => {
                  void deleteEdgeAction(selEdge.id)
                  setEdges(eds => eds.filter(x => x.id !== String(selEdge.id)))
                  setSelEdge(null)
                }}
                onClose={() => setSelEdge(null)}
              />
            </Panel>
          )}
        </ReactFlow>
      </div>

      {isOwner && shareOpen && (
        <SharePanel board={board} onClose={() => setShareOpen(false)} />
      )}
    </div>
  )
}

// ---- typed-edge editor (AP-14) ----

function EdgeEditor({
  sel, onKind, onLabel, onDirected, onDelete, onClose,
}: {
  sel: { id: number; kind: string | null; label: string | null; directed: boolean }
  onKind: (k: string) => void
  onLabel: (l: string | null) => void
  onDirected: (d: boolean) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(sel.label ?? '')
  const activeKind = sel.kind ?? 'relates'

  return (
    <div className="w-60 bg-ark-bg border border-ark-accent/40 shadow-2xl font-mono text-[11px]">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-ark-border bg-ark-surface/60">
        <span className="tracking-widest uppercase text-ark-accent">连线</span>
        <button onClick={onClose} className="text-ark-muted hover:text-ark-accent text-sm leading-none">×</button>
      </div>
      <div className="p-2.5 space-y-2.5">
        {/* kind chips */}
        <div className="flex flex-wrap gap-1">
          {EDGE_KINDS.map(k => (
            <button
              key={k.key}
              onClick={() => onKind(k.key)}
              className="px-1.5 py-0.5 border tracking-widest transition-colors"
              style={activeKind === k.key
                ? { borderColor: k.color, color: k.color, background: k.color + '18' }
                : { borderColor: '#2a2d2e', color: '#888' }}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* label */}
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => onLabel(label.trim() || null)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="备注（可选）"
          className="w-full bg-ark-surface border border-ark-border px-2 py-1 text-ark-text placeholder:text-ark-muted/60 outline-none focus:border-ark-accent-dim font-sans"
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 cursor-pointer text-ark-muted hover:text-ark-text">
            <input type="checkbox" checked={sel.directed} onChange={e => onDirected(e.target.checked)}
                   className="accent-ark-accent" />
            有向 →
          </label>
          <button onClick={onDelete} className="tracking-widest uppercase text-ark-muted hover:text-ark-danger">
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
