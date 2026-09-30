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
  type EdgeMouseHandler,
  type NodeChange,
  type OnConnectEnd,
  type OnDelete,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react'
import { LayoutGrid, Maximize, Plus, Redo2, Scissors, Undo2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { attachToFrame, pictureAssets } from '../lib/attach'
import { useUser } from '../lib/auth'
import { droppedAssetIds, isMediaDrag } from '../lib/dnd'
import { importFiles, mediaFiles } from '../lib/media'
import { useTheme } from '../lib/prefs'
import { toast, toastError } from '../lib/toast'
import { useSnapshot, useUndoRedo } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, IconButton, Kbd } from '../ui'
import { BoardActionsContext, focusFrameText, takeReveal, type BoardActions } from './actions'
import { FrameNode, type FrameNodeData, type FrameNodeType } from './FrameNode'
import { Inspector } from './Inspector'
import { stripLayout, type Point } from './layout'
import { LinkEdge, type LinkEdgeType } from './LinkEdge'
import { GAP_X, GAP_Y, cardSize, type CardSize } from './sizes'

const nodeTypes = { frame: FrameNode }
const edgeTypes = { link: LinkEdge }

type DropTarget = { kind: 'link'; linkId: string } | { kind: 'frame'; frameId: string; side: 'before' | 'after' } | null

const sameTarget = (a: DropTarget, b: DropTarget) =>
  a === b ||
  (a !== null &&
    b !== null &&
    (a.kind === 'link' && b.kind === 'link'
      ? a.linkId === b.linkId
      : a.kind === 'frame' && b.kind === 'frame' && a.frameId === b.frameId && a.side === b.side))

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
    a.dropSide === b.dropSide &&
    a.hasLinks === b.hasLinks &&
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

function distanceToSegment(p: XYPosition, a: XYPosition, b: XYPosition): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function segmentsCross(a: XYPosition, b: XYPosition, c: XYPosition, d: XYPosition): boolean {
  const cross = (o: XYPosition, p: XYPosition, q: XYPosition) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
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
  const linkedFrames = useMemo(() => {
    const ids = new Set<string>()
    for (const l of Object.values(s.links)) {
      ids.add(l.from)
      ids.add(l.to)
    }
    return ids
  }, [s.links])

  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const dropTargetRef = useRef<DropTarget>(null)

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
        duration: item ? item.base : baseDuration(frame, s.meta, s.assets),
        overridden: item?.overridden ?? false,
        inCut: item !== undefined,
        hiddenInCut: item?.hidden ?? false,
        hero: heroAsset ? { hash: heroAsset.hash, kind: heroAsset.kind } : null,
        refs: frame.references.flatMap((id) => {
          const a = s.assets[id]
          return a ? [{ id: a.id, hash: a.hash, kind: a.kind, title: a.title || a.name }] : []
        }),
        size,
        dropSide: dropTarget?.kind === 'frame' && dropTarget.frameId === frame.id ? dropTarget.side : null,
        hasLinks: linkedFrames.has(frame.id),
      }
      const prev = dataCache.current.get(frame.id)
      next.set(frame.id, prev && sameNodeData(prev, candidate) ? prev : candidate)
    }
    dataCache.current = next
    return next
  }, [frameList, timeline, labels, s.assets, s.meta, size, dropTarget, linkedFrames])

  // ------------------------------------------------------------ node state

  const [nodes, setNodes] = useState<FrameNodeType[]>([])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const dragging = useRef(new Set<string>())
  const pendingSelect = useRef<string | null>(null)
  // Bumped to put frames back in their auto-arranged places after a drag that didn't move anything.
  const [snapBack, setSnapBack] = useState(0)

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
  }, [frameList, nodeData, layout, size, snapBack])

  const onNodesChange = useCallback((changes: NodeChange<FrameNodeType>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.dragging) dragging.current.add(c.id)
    }
    // Deletions go through the project (onDelete), not local state.
    setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current))
  }, [])

  const selectedFrameIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes])
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)

  /** Pans to a frame if it's off screen, once React Flow knows where it is. */
  const reveal = useCallback(
    (frameId: string) => {
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
    },
    [flow, size],
  )

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
    [reveal],
  )

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
        data: {
          link,
          inCut: inCut.has(link.id),
          start: timeline.byFrame.get(link.to)?.start ?? null,
          dropTarget: dropTarget?.kind === 'link' && dropTarget.linkId === link.id,
        },
      }))
  }, [s.links, s.frames, timeline, selectedLinkId, dropTarget])

  const onEdgesChange = useCallback((changes: EdgeChange<LinkEdgeType>[]) => {
    for (const c of changes) {
      if (c.type === 'select') setSelectedLinkId((cur) => (c.selected ? c.id : cur === c.id ? null : cur))
    }
  }, [])

  // --------------------------------------------------------------- actions

  const insertAfter = useCallback(
    (frameId: string) => selectFrame(project.insertFrameAfter(frameId, { cutId }), { focus: true }),
    [project, cutId, selectFrame],
  )
  const insertBefore = useCallback(
    (frameId: string) => selectFrame(project.insertFrameBefore(frameId, { cutId }), { focus: true }),
    [project, cutId, selectFrame],
  )
  const addVariation = useCallback(
    (frameId: string) => selectFrame(project.addVariation(frameId), { focus: true }),
    [project, selectFrame],
  )
  const appendFrame = useCallback(
    () => selectFrame(project.appendFrame(cutId), { focus: true }),
    [project, cutId, selectFrame],
  )
  const cutLink = useCallback(
    (linkId: string) => {
      project.deleteLink(linkId)
      setSelectedLinkId(null)
    },
    [project],
  )

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

  /** Each image or video becomes a new frame at the end of the cut. */
  const framesFromAssets = useCallback(
    (assetIds: string[], at?: Point) => {
      const ids = pictureAssets(project, assetIds)
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
    [project, cutId, size, selectFrame],
  )

  const framesFromFiles = useCallback(
    async (files: File[], at?: Point) => framesFromAssets(await importFiles(project, files, user.id), at),
    [project, user.id, framesFromAssets],
  )

  // Opened from Write or the Library to show a particular frame.
  useEffect(() => {
    const frameId = takeReveal()
    if (frameId && project.getFrame(frameId)) selectFrame(frameId)
  }, [project, selectFrame])

  const actions: BoardActions = useMemo(
    () => ({
      insertAfter,
      insertBefore,
      addVariation,
      detach: (frameId) => project.detachFrame(frameId),
      remove: (frameId) => project.deleteFrames([frameId]),
      toggleHidden: (frameId) => {
        const item = cutTimeline(project.snapshot(), cutId).byFrame.get(frameId)
        if (item) project.setHidden(cutId, frameId, !item.hidden)
      },
      selectLink: (linkId) => {
        setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
        setSelectedLinkId(linkId)
      },
      cutLink,
      importToFrame: (frameId, files, target) => void importToFrame(frameId, files, target),
      attachToFrame: (frameId, assetIds, target) => attachToFrame(project, frameId, assetIds, target),
    }),
    [insertAfter, insertBefore, addVariation, project, cutId, cutLink, importToFrame],
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

  const onEdgeClick: EdgeMouseHandler<LinkEdgeType> = useCallback(
    (event, edge) => {
      if (event.altKey) cutLink(edge.id)
    },
    [cutLink],
  )

  // ------------------------------------------------- dragging to rearrange

  /** Where a dragged frame would land: next to a frame under the pointer, or into a link near it. */
  const findDropTarget = useCallback(
    (dragId: string, point: XYPosition): DropTarget => {
      const { width: w, height: h } = size
      for (const n of nodesRef.current) {
        if (n.id === dragId) continue
        const { x, y } = n.position
        if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
          return { kind: 'frame', frameId: n.id, side: point.x < x + w / 2 ? 'before' : 'after' }
        }
      }
      const positions = new Map(nodesRef.current.map((n) => [n.id, n.position]))
      let best: DropTarget = null
      let bestDistance = 36 / flow.getZoom()
      for (const link of Object.values(project.snapshot().links)) {
        if (link.from === dragId || link.to === dragId) continue
        const a = positions.get(link.from)
        const b = positions.get(link.to)
        if (!a || !b) continue
        const d = distanceToSegment(point, { x: a.x + w, y: a.y + h / 2 }, { x: b.x, y: b.y + h / 2 })
        if (d < bestDistance) {
          bestDistance = d
          best = { kind: 'link', linkId: link.id }
        }
      }
      return best
    },
    [size, flow, project],
  )

  const onNodeDrag: OnNodeDrag<FrameNodeType> = useCallback(
    (event, node, dragged) => {
      const pointer = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : event
      const target =
        dragged.length === 1 && pointer
          ? findDropTarget(node.id, flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }))
          : null
      if (!sameTarget(target, dropTargetRef.current)) {
        dropTargetRef.current = target
        setDropTarget(target)
      }
    },
    [findDropTarget, flow],
  )

  const reorderHintShown = useRef(false)

  const onNodeDragStop: OnNodeDrag<FrameNodeType> = useCallback(
    (event, _node, dragged) => {
      const target = dropTargetRef.current
      dropTargetRef.current = null
      setDropTarget(null)
      for (const n of dragged) dragging.current.delete(n.id)
      const autoLayout = project.getMeta().autoLayout
      const only = dragged.length === 1 ? dragged[0] : undefined

      if (only && target) {
        project.transact(() => {
          if (target.kind === 'link') project.moveFrameToLink(only.id, target.linkId)
          else project.moveFrameNextTo(only.id, target.frameId, target.side, cutId)
          if (!autoLayout) project.setPositions({ [only.id]: only.position })
        })
        return
      }
      if (only && event.altKey) {
        project.transact(() => {
          project.detachFrame(only.id)
          if (!autoLayout) project.setPositions({ [only.id]: only.position })
        })
        return
      }
      if (autoLayout) {
        setSnapBack((n) => n + 1)
        if (!reorderHintShown.current) {
          reorderHintShown.current = true
          toast('To move a frame, drop it onto a link or beside another frame. Turn off auto-arrange to place frames freely.')
        }
        return
      }
      project.setPositions(Object.fromEntries(dragged.map((n) => [n.id, n.position])))
    },
    [project, cutId],
  )

  const toggleAutoLayout = useCallback(() => {
    if (project.getMeta().autoLayout) {
      // Leave every frame where it is now.
      const positions = Object.fromEntries(nodesRef.current.map((n) => [n.id, n.position]))
      project.transact(() => {
        project.setPositions(positions)
        project.updateMeta({ autoLayout: false })
      })
    } else {
      project.updateMeta({ autoLayout: true })
    }
  }, [project])

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

  // ------------------------------------------------------------ knife tool

  const [knifeMode, setKnifeMode] = useState(false)
  const [knifePath, setKnifePath] = useState<XYPosition[] | null>(null)
  const knife = useRef<{ points: XYPosition[]; pointerId: number } | null>(null)
  const suppressContextMenu = useRef(false)

  const localPoint = (e: ReactPointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const starts = (knifeMode && e.button === 0) || (e.button === 2 && e.ctrlKey)
    if (!starts || (e.target as HTMLElement).closest('.react-flow__panel, .react-flow__controls, .react-flow__minimap')) return
    e.preventDefault()
    e.stopPropagation()
    suppressContextMenu.current = e.button === 2
    const point = localPoint(e)
    knife.current = { points: [point], pointerId: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    setKnifePath([point])
  }

  const onPointerMoveCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = knife.current
    if (!current) return
    e.preventDefault()
    e.stopPropagation()
    const point = localPoint(e)
    const last = current.points[current.points.length - 1]!
    if (Math.hypot(point.x - last.x, point.y - last.y) > 3) {
      current.points.push(point)
      setKnifePath([...current.points])
    }
  }

  const onPointerUpCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = knife.current
    if (!current) return
    e.stopPropagation()
    knife.current = null
    if (e.currentTarget.hasPointerCapture(current.pointerId)) e.currentTarget.releasePointerCapture(current.pointerId)
    setKnifePath(null)
    const rect = containerRef.current!.getBoundingClientRect()
    const stroke = current.points.map((p) => flow.screenToFlowPosition({ x: p.x + rect.left, y: p.y + rect.top }))
    const positions = new Map(nodesRef.current.map((n) => [n.id, n.position]))
    const { width: w, height: h } = size
    const cut = Object.values(project.snapshot().links).filter((link) => {
      const a = positions.get(link.from)
      const b = positions.get(link.to)
      if (!a || !b) return false
      const from = { x: a.x + w, y: a.y + h / 2 }
      const to = { x: b.x, y: b.y + h / 2 }
      return stroke.some((p, i) => i > 0 && segmentsCross(stroke[i - 1]!, p, from, to))
    })
    if (cut.length) {
      project.deleteLinks(cut.map((l) => l.id))
      toast(`Cut ${cut.length} ${cut.length === 1 ? 'link' : 'links'}. Ctrl+Z brings them back.`)
    }
  }

  const onContextMenuCapture = (e: ReactMouseEvent) => {
    if (suppressContextMenu.current || e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      suppressContextMenu.current = false
    }
  }

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
      } else if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        setKnifeMode((on) => !on)
      } else if (e.key === 'Escape') {
        setKnifeMode(false)
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
    if (!isMediaDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onPaneDrop = (e: DragEvent) => {
    const files = mediaFiles(e.dataTransfer)
    const assetIds = droppedAssetIds(e.dataTransfer)
    if (!files.length && !assetIds.length) return
    e.preventDefault()
    const at = auto ? undefined : flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (files.length) void framesFromFiles(files, at)
    else framesFromAssets(assetIds, at)
  }

  const onlyFrame = frameList.length === 1 ? frameList[0] : undefined
  const blank = !!onlyFrame && !onlyFrame.description && !onlyFrame.media.length && !onlyFrame.audio.some((l) => l.text)

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1"
        style={{ cursor: knifeMode ? 'crosshair' : undefined }}
        onDragOver={onPaneDragOver}
        onDrop={onPaneDrop}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMoveCapture={onPointerMoveCapture}
        onPointerUpCapture={onPointerUpCapture}
        onContextMenuCapture={onContextMenuCapture}
      >
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
            onEdgeClick={onEdgeClick}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onDelete={onDelete}
            onPaneClick={() => setSelectedLinkId(null)}
            deleteKeyCode={['Delete', 'Backspace']}
            zoomOnDoubleClick={false}
            panOnDrag={!knifeMode}
            nodesDraggable={!knifeMode}
            nodesConnectable={!knifeMode}
            elementsSelectable={!knifeMode}
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
                  label="Cut links"
                  tooltip={
                    <span>
                      Cut links: drag across them <Kbd>K</Kbd>, or <Kbd>Ctrl</Kbd> + right-drag
                    </span>
                  }
                  active={knifeMode}
                  onClick={() => setKnifeMode((on) => !on)}
                >
                  <Scissors size={15} />
                </IconButton>
                <IconButton
                  size="sm"
                  label={auto ? 'Auto-arrange is on' : 'Auto-arrange is off'}
                  tooltip={auto ? 'Auto-arrange is on. Click to place frames freely.' : 'Auto-arrange is off. Click to tidy up.'}
                  active={auto}
                  onClick={toggleAutoLayout}
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
              {knifeMode && (
                <div className="rounded-lg border border-danger/40 bg-panel px-3 py-2 text-[12px] text-fg-2 shadow-pop">
                  Drag across links to cut them. <Kbd>Esc</Kbd> to stop.
                </div>
              )}
              {blank && !knifeMode && (
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
        {knifePath && knifePath.length > 1 && (
          <svg className="pointer-events-none absolute inset-0 z-10 size-full" aria-hidden>
            <polyline
              points={knifePath.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--danger)"
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel">
        <Inspector cutId={cutId} frameIds={selectedFrameIds} linkId={selectedLinkId} onFrameCreated={selectFrame} />
      </aside>
    </div>
  )
}
