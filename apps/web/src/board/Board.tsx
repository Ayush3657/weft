import { baseDuration, byCreation, cutTimeline, shotLabels, type FrameSnapshot, type ProjectSnapshot } from '@weft/model'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type OnDelete,
  type OnNodeDrag,
} from '@xyflow/react'
import { LayoutGrid, Maximize, Plus, Redo2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { importFiles, mediaFiles } from '../lib/media'
import { useTheme } from '../lib/prefs'
import { toast, toastError } from '../lib/toast'
import { useSnapshot, useUndoRedo } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, IconButton, Kbd } from '../ui'
import { BoardActionsContext, focusFrameText, type BoardActions } from './actions'
import { FrameNode, type FrameNodeData, type FrameNodeType } from './FrameNode'
import { Inspector } from './Inspector'
import { stripLayout, type Point } from './layout'
import { LinkEdge, type LinkEdgeType } from './LinkEdge'
import { GAP_X, GAP_Y, cardSize, type CardSize } from './sizes'

const nodeTypes = { frame: FrameNode }
const edgeTypes = { link: LinkEdge }

export function Board({ cutId }: { cutId: string }) {
  return (
    <ReactFlowProvider>
      <BoardView cutId={cutId} />
    </ReactFlowProvider>
  )
}

function sameNodeData(a: FrameNodeData, b: FrameNodeData): boolean {
  return (
    a.frame === b.frame &&
    a.label === b.label &&
    a.duration === b.duration &&
    a.overridden === b.overridden &&
    a.inCut === b.inCut &&
    a.hiddenInCut === b.hiddenInCut &&
    a.size === b.size &&
    a.hero?.hash === b.hero?.hash &&
    a.hero?.kind === b.hero?.kind &&
    a.refs.length === b.refs.length &&
    a.refs.every((r, i) => r.id === b.refs[i]?.id && r.hash === b.refs[i]?.hash)
  )
}

/** Signature of everything the automatic layout depends on. */
function layoutKey(s: ProjectSnapshot): string {
  const main = s.cuts[s.meta.mainCutId]
  const frames = Object.keys(s.frames).sort().join(',')
  const links = Object.values(s.links)
    .map((l) => `${l.id}:${l.from}>${l.to}`)
    .sort()
    .join(',')
  return `${frames}|${links}|${main ? `${main.start}:${JSON.stringify(main.choices)}` : ''}`
}

function BoardView({ cutId }: { cutId: string }) {
  const { project } = useProjectContext()
  const user = useUser()
  const s = useSnapshot()
  const flow = useReactFlow<FrameNodeType, LinkEdgeType>()
  const [theme] = useTheme()
  const { undo, redo, canUndo, canRedo } = useUndoRedo()
  const containerRef = useRef<HTMLDivElement>(null)

  const size: CardSize = useMemo(() => cardSize(s.meta.aspect), [s.meta.aspect])
  const timeline = cutTimeline(s, cutId)
  const labels = shotLabels(s)
  const auto = s.meta.autoLayout
  const key = layoutKey(s)
  const layout = useMemo(
    () => (auto ? stripLayout(s, s.meta.mainCutId, size.width + GAP_X, size.height + GAP_Y) : null),
    // The layout only depends on structure, which `key` captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto, key, size],
  )

  const frameList = useMemo(() => Object.values(s.frames).sort(byCreation), [s.frames])

  // Node data, reusing the previous object when nothing on the card changed.
  const dataCache = useRef(new Map<string, FrameNodeData>())
  const nodeData = useMemo(() => {
    const next = new Map<string, FrameNodeData>()
    for (const frame of frameList) {
      const item = timeline.byFrame.get(frame.id)
      const heroVersion = frame.media.find((m) => m.id === frame.heroMediaId)
      const heroAsset = heroVersion ? s.assets[heroVersion.assetId] : undefined
      const candidate: FrameNodeData = {
        frame,
        label: labels.get(frame.id) ?? null,
        duration: item ? item.base : baseDuration(frame, s.meta),
        overridden: item?.overridden ?? false,
        inCut: item !== undefined,
        hiddenInCut: item?.hidden ?? false,
        hero: heroAsset ? { hash: heroAsset.hash, kind: heroAsset.kind } : null,
        refs: frame.references.flatMap((id) => {
          const a = s.assets[id]
          return a ? [{ id: a.id, hash: a.hash, kind: a.kind, title: a.title || a.name }] : []
        }),
        size,
      }
      const prev = dataCache.current.get(frame.id)
      next.set(frame.id, prev && sameNodeData(prev, candidate) ? prev : candidate)
    }
    dataCache.current = next
    return next
  }, [frameList, timeline, labels, s.assets, s.meta, size])

  // ------------------------------------------------------------ node state

  const [nodes, setNodes] = useState<FrameNodeType[]>([])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const dragging = useRef(new Set<string>())
  const pendingSelect = useRef<string | null>(null)

  useEffect(() => {
    // A frame created by a command becomes selected once it shows up. Read the
    // ref here, not inside the updater: updaters must stay pure (StrictMode runs them twice).
    const select = pendingSelect.current !== null && nodeData.has(pendingSelect.current) ? pendingSelect.current : null
    if (select !== null) pendingSelect.current = null
    const applySelect = select !== null
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      let changed = prev.length !== frameList.length || applySelect
      const next = frameList.map((frame: FrameSnapshot, i) => {
        const existing = byId.get(frame.id)
        const data = nodeData.get(frame.id)!
        const target: Point = layout?.get(frame.id) ?? { x: frame.x, y: frame.y }
        const position = existing && dragging.current.has(frame.id) ? existing.position : target
        const selected = applySelect ? frame.id === select : (existing?.selected ?? false)
        if (
          existing &&
          existing.data === data &&
          existing.position.x === position.x &&
          existing.position.y === position.y &&
          existing.width === size.width &&
          existing.selected === selected
        ) {
          if (prev[i] !== existing) changed = true
          return existing
        }
        changed = true
        return {
          ...existing,
          id: frame.id,
          type: 'frame' as const,
          position,
          data,
          selected,
          width: size.width,
          height: size.height,
        }
      })
      return changed ? next : prev
    })
  }, [frameList, nodeData, layout, size])

  const onNodesChange = useCallback((changes: NodeChange<FrameNodeType>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.dragging) dragging.current.add(c.id)
    }
    // Deletions go through the project (onDelete), not local state.
    setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current))
  }, [])

  const selectedFrameIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes])
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)

  const selectFrame = useCallback(
    (frameId: string, { focus = false }: { focus?: boolean } = {}) => {
      setSelectedLinkId(null)
      if (nodesRef.current.some((n) => n.id === frameId)) {
        setNodes((current) =>
          current.map((n) => (n.selected === (n.id === frameId) ? n : { ...n, selected: n.id === frameId })),
        )
      } else {
        pendingSelect.current = frameId
      }
      reveal(frameId)
      if (focus) focusFrameText(frameId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /** Pans to a frame if it's off screen, once React Flow knows where it is. */
  const reveal = (frameId: string) => {
    let tries = 0
    const attempt = () => {
      const node = flow.getInternalNode(frameId)
      const el = containerRef.current
      if (!node || !el) {
        if (tries++ < 12) requestAnimationFrame(attempt)
        return
      }
      const { x, y } = node.internals.positionAbsolute
      const w = node.measured.width ?? size.width
      const h = node.measured.height ?? size.height
      const { x: vx, y: vy, zoom } = flow.getViewport()
      const margin = 48
      const left = x * zoom + vx
      const top = y * zoom + vy
      const offscreen =
        left < margin || top < margin || left + w * zoom > el.clientWidth - margin || top + h * zoom > el.clientHeight - margin
      if (offscreen) void flow.setCenter(x + w / 2, y + h / 2, { zoom, duration: 250 })
    }
    requestAnimationFrame(attempt)
  }

  // ------------------------------------------------------------ edge state

  const edges = useMemo<LinkEdgeType[]>(() => {
    const inCut = new Set(timeline.items.map((i) => i.linkInId).filter((id): id is string => id !== null))
    return Object.values(s.links)
      .filter((l) => s.frames[l.from] && s.frames[l.to])
      .map((link) => ({
        id: link.id,
        source: link.from,
        target: link.to,
        type: 'link' as const,
        selected: link.id === selectedLinkId,
        zIndex: inCut.has(link.id) ? 1 : 0,
        data: { link, inCut: inCut.has(link.id), start: timeline.byFrame.get(link.to)?.start ?? null },
      }))
  }, [s.links, s.frames, timeline, selectedLinkId])

  const onEdgesChange = useCallback((changes: EdgeChange<LinkEdgeType>[]) => {
    for (const c of changes) {
      if (c.type === 'select') setSelectedLinkId((cur) => (c.selected ? c.id : cur === c.id ? null : cur))
    }
  }, [])

  // --------------------------------------------------------------- actions

  const insertAfter = useCallback(
    (frameId: string) => {
      const id = project.insertFrameAfter(frameId, { cutId })
      selectFrame(id, { focus: true })
    },
    [project, cutId, selectFrame],
  )

  const addVariation = useCallback(
    (frameId: string) => {
      const id = project.addVariation(frameId)
      selectFrame(id, { focus: true })
    },
    [project, selectFrame],
  )

  const appendFrame = useCallback(() => {
    const id = project.appendFrame(cutId)
    selectFrame(id, { focus: true })
  }, [project, cutId, selectFrame])

  const importToFrame = useCallback(
    async (frameId: string, files: File[], target: 'media' | 'references') => {
      const ids = await importFiles(project, files, user.id)
      if (!ids.length || !project.getFrame(frameId)) return
      project.transact(() => {
        for (const assetId of ids) {
          if (target === 'media') project.addMediaVersion(frameId, assetId)
          else project.addReference(frameId, assetId)
        }
      })
    },
    [project, user.id],
  )

  /** Each file becomes a new frame at the end of the cut. */
  const framesFromFiles = useCallback(
    async (files: File[], at?: Point) => {
      const ids = await importFiles(project, files, user.id)
      if (!ids.length) return
      let last: string | null = null
      project.transact(() => {
        ids.forEach((assetId, k) => {
          const init = at ? { x: at.x + k * (size.width + GAP_X), y: at.y } : {}
          const frameId = project.appendFrame(cutId, init)
          project.addMediaVersion(frameId, assetId, { source: 'upload' })
          last = frameId
        })
      })
      if (last) selectFrame(last)
    },
    [project, user.id, cutId, size, selectFrame],
  )

  const actions: BoardActions = useMemo(
    () => ({
      insertAfter,
      addVariation,
      selectLink: (linkId) => {
        setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
        setSelectedLinkId(linkId)
      },
      importToFrame: (frameId, files, target) => void importToFrame(frameId, files, target),
    }),
    [insertAfter, addVariation, importToFrame],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      try {
        project.linkFrames(c.source, c.target)
      } catch (error) {
        toastError(error)
      }
    },
    [project],
  )

  // Dragging from a dot into empty space creates a connected frame there.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.toNode) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      if (!point) return
      const pos = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY })
      const from = state.fromNode.id
      const outgoing = state.fromHandle?.type !== 'target'
      try {
        const id = project.transact(() => {
          const created = project.createFrame({
            x: pos.x - (outgoing ? 0 : size.width),
            y: pos.y - size.height / 2,
            sceneId: s.frames[from]?.sceneId ?? null,
          })
          if (outgoing) project.linkFrames(from, created)
          else project.linkFrames(created, from)
          return created
        })
        selectFrame(id, { focus: true })
      } catch (error) {
        toastError(error)
      }
    },
    [flow, project, size, s.frames, selectFrame],
  )

  const onNodeDragStop: OnNodeDrag<FrameNodeType> = useCallback(
    (_event, _node, dragged) => {
      const moved = Object.fromEntries(dragged.map((n) => [n.id, n.position]))
      for (const n of dragged) dragging.current.delete(n.id)
      if (project.getMeta().autoLayout) {
        const all = Object.fromEntries(nodesRef.current.map((n) => [n.id, moved[n.id] ?? n.position]))
        project.transact(() => {
          project.setPositions(all)
          project.updateMeta({ autoLayout: false })
        })
        toast('Frames now stay where you put them. Tidy turns auto-arrange back on.')
      } else {
        project.setPositions(moved)
      }
    },
    [project],
  )

  const onDelete: OnDelete<FrameNodeType, LinkEdgeType> = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }) => {
      project.transact(() => {
        const frameIds = new Set(deletedNodes.map((n) => n.id))
        for (const e of deletedEdges) if (!frameIds.has(e.source) && !frameIds.has(e.target)) project.deleteLink(e.id)
        if (frameIds.size) project.deleteFrames([...frameIds])
      })
      setSelectedLinkId(null)
    },
    [project],
  )

  // ------------------------------------------------------ keyboard, paste

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const only = selectedFrameIds.length === 1 ? selectedFrameIds[0] : undefined
      if (e.key === 'Enter' && only) {
        e.preventDefault()
        if (e.shiftKey) addVariation(only)
        else insertAfter(only)
      } else if (e.key === 'Escape') {
        setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
        setSelectedLinkId(null)
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const files = mediaFiles(e.clipboardData)
      if (!files.length) return
      e.preventDefault()
      const only = selectedFrameIds.length === 1 ? selectedFrameIds[0] : undefined
      if (only) void importToFrame(only, files, 'media')
      else void framesFromFiles(files)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [selectedFrameIds, insertAfter, addVariation, importToFrame, framesFromFiles])

  const onPaneDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onPaneDrop = (e: DragEvent) => {
    const files = mediaFiles(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    const at = auto ? undefined : flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    void framesFromFiles(files, at)
  }

  const onlyFrame = frameList.length === 1 ? frameList[0] : undefined
  const blank = !!onlyFrame && !onlyFrame.description && !onlyFrame.media.length && !onlyFrame.audio.some((l) => l.text)

  return (
    <div className="flex h-full min-h-0">
      <div ref={containerRef} className="relative min-w-0 flex-1" onDragOver={onPaneDragOver} onDrop={onPaneDrop}>
        <BoardActionsContext.Provider value={actions}>
          <ReactFlow<FrameNodeType, LinkEdgeType>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodeDragStop={onNodeDragStop}
            onDelete={onDelete}
            onPaneClick={() => setSelectedLinkId(null)}
            deleteKeyCode={['Delete', 'Backspace']}
            colorMode={theme}
            minZoom={0.1}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            connectionRadius={30}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--canvas-dot)" />
            <Controls showInteractive={false} position="bottom-left" />
            {frameList.length > 8 && (
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(n) => ((n.data as FrameNodeData).inCut ? 'var(--accent)' : 'var(--line-strong)')}
                maskColor="rgb(0 0 0 / 0.35)"
                className="!rounded-lg !border !border-line"
              />
            )}
            <Panel position="top-left" className="flex flex-col items-start gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-1 shadow-pop">
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={appendFrame}>
                  Frame
                </Button>
                <span className="mx-0.5 h-5 w-px bg-line" />
                <IconButton size="sm" label="Undo" tooltip={<span>Undo <Kbd>Ctrl Z</Kbd></span>} onClick={undo} disabled={!canUndo}>
                  <Undo2 size={15} />
                </IconButton>
                <IconButton size="sm" label="Redo" tooltip={<span>Redo <Kbd>Ctrl Shift Z</Kbd></span>} onClick={redo} disabled={!canRedo}>
                  <Redo2 size={15} />
                </IconButton>
                <span className="mx-0.5 h-5 w-px bg-line" />
                <IconButton
                  size="sm"
                  label={auto ? 'Auto-arrange is on' : 'Tidy: arrange frames automatically'}
                  active={auto}
                  onClick={() => project.updateMeta({ autoLayout: true })}
                >
                  <LayoutGrid size={15} />
                </IconButton>
                <IconButton
                  size="sm"
                  label="Fit to screen"
                  onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1, duration: 300 })}
                >
                  <Maximize size={15} />
                </IconButton>
              </div>
              {blank && (
                <div className="max-w-[300px] rounded-lg border border-line bg-panel px-3.5 py-3 text-fg-2 shadow-pop">
                  <p className="font-medium text-fg">Start with your first shot</p>
                  <p className="mt-1">
                    Type what happens, then press <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> for the next frame. Drop or paste
                    images onto a frame.
                  </p>
                </div>
              )}
            </Panel>
          </ReactFlow>
        </BoardActionsContext.Provider>
      </div>
      <aside className={cx('w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel')}>
        <Inspector cutId={cutId} frameIds={selectedFrameIds} linkId={selectedLinkId} onFrameCreated={selectFrame} />
      </aside>
    </div>
  )
}
