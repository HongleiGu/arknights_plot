'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge as rfAddEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SearchAdd from './SearchAdd'
import {
  addCardMember,
  addEdge as addEdgeAction,
  deleteEdge as deleteEdgeAction,
  deleteMember,
  updateBoard,
  updateEdge,
  updateMember,
  type Board,
  type BoardMember,
} from '@/app/actions/boards'

const TYPE_ICON: Record<string, string> = {
  story: '◈', chapter: '§', node: '¶', gadget: '◆',
  event: '❖', option: '▸', text: '✎', furniture: '⌂',
}

interface NodeData extends Record<string, unknown> {
  member: BoardMember
  isOwner: boolean
  onEditCard: (id: number) => void
}

function memberToNode(m: BoardMember, isOwner: boolean, onEditCard: (id: number) => void): Node<NodeData> {
  return {
    id: String(m.id),
    type: m.kind,
    position: { x: m.x, y: m.y },
    draggable: isOwner,
    data: { member: m, isOwner, onEditCard },
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
  const { member, isOwner, onEditCard } = data
  return (
    <div
      onDoubleClick={() => isOwner && onEditCard(member.id)}
      className="w-48 min-h-12 bg-ark-accent/10 border border-ark-accent/40 rounded shadow-lg p-2 text-xs"
      title={isOwner ? '双击编辑' : undefined}
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
    board.members.map(m => memberToNode(m, isOwner, onEditCard)),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    board.edges.map(e => ({ id: String(e.id), source: String(e.from), target: String(e.to), label: e.label ?? undefined })),
  )
  const [layout, setLayout] = useState(board.layout)
  const [msg, setMsg] = useState<string | null>(null)

  // Persist a node's position after a drag.
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    if (!isOwner || layout === 'timeline') return
    void updateMember(Number(node.id), { x: node.position.x, y: node.position.y })
  }, [isOwner, layout])

  // Connect two nodes → an edge.
  const onConnect = useCallback((c: Connection) => {
    if (!isOwner || !c.source || !c.target) return
    void addEdgeAction(board.id, Number(c.source), Number(c.target)).then(res => {
      if (res.ok) {
        setEdges(eds => rfAddEdge({ id: String(res.edge.id), source: c.source!, target: c.target! }, eds))
      }
    })
  }, [isOwner, board.id, setEdges])

  const onEdgeDoubleClick = useCallback((_e: unknown, edge: Edge) => {
    if (!isOwner) return
    const next = window.prompt('连线标签', (edge.label as string) ?? '')
    if (next == null) return
    void updateEdge(Number(edge.id), { label: next || null })
    setEdges(eds => eds.map(x => (x.id === edge.id ? { ...x, label: next || undefined } : x)))
  }, [isOwner, setEdges])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (!isOwner) return
    for (const n of deleted) void deleteMember(Number(n.id))
  }, [isOwner])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (!isOwner) return
    for (const e of deleted) void deleteEdgeAction(Number(e.id))
  }, [isOwner])

  async function addCard() {
    const text = window.prompt('卡片内容')
    if (text == null || !text.trim()) return
    const res = await addCardMember(board.id, text)
    if (!res.ok) { setMsg(res.error); return }
    setNodes(ns => [...ns, memberToNode(res.member, isOwner, onEditCard)])
  }

  function toggleLayout() {
    const next = layout === 'timeline' ? 'board' : 'timeline'
    setLayout(next)
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
        {!isOwner && <span className="font-mono text-[10px] text-ark-muted tracking-widest uppercase">只读</span>}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {isOwner && (
            <>
              <SearchAdd
                boardId={board.id}
                onAdded={m => setNodes(ns => [...ns, memberToNode(m, isOwner, onEditCard)])}
              />
              <button onClick={addCard} className="font-mono text-[10px] tracking-widest uppercase px-2 py-1 border border-ark-border text-ark-muted hover:text-ark-accent hover:border-ark-accent-dim transition-colors">
                + 卡片
              </button>
            </>
          )}
          <button onClick={toggleLayout} className="font-mono text-[10px] tracking-widest uppercase px-2 py-1 border border-ark-accent text-ark-accent hover:bg-ark-accent hover:text-ark-bg transition-colors">
            {layout === 'timeline' ? '板视图' : '时间线'}
          </button>
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
          onEdgeDoubleClick={onEdgeDoubleClick}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          nodesDraggable={isOwner && layout !== 'timeline'}
          nodesConnectable={isOwner}
          elementsSelectable={isOwner}
          deleteKeyCode={isOwner ? 'Delete' : null}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-ark-bg"
        >
          <Background color="#1d1f20" gap={24} />
          <Controls className="!bg-ark-surface !border-ark-border" />
        </ReactFlow>
      </div>
    </div>
  )
}
