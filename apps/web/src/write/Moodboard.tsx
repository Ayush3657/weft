import { byCreation, type AssetSnapshot, type MoodItemSnapshot } from '@weft/model'
import {
  Background,
  BackgroundVariant,
  Controls,
  NodeResizer,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnDelete,
  type OnNodeDrag,
} from '@xyflow/react'
import {
  AudioLines,
  Copy,
  ExternalLink,
  Frame,
  ImagePlus,
  LayoutGrid,
  Link2,
  Maximize,
  PictureInPicture2,
  Redo2,
  Send,
  StickyNote,
  SwatchBook,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { MediaFill } from '../board/Media'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { droppedAssetIds, isMediaDrag } from '../lib/dnd'
import { addLink, singleUrl } from '../lib/links'
import { displayUrl, importFiles, mediaFiles } from '../lib/media'
import { useTheme } from '../lib/prefs'
import { writePath } from '../lib/router'
import { toast } from '../lib/toast'
import { BoundInput, BoundTextarea } from '../project/BoundText'
import { useProject, useSnapshot, useUndoRedo } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, ContextMenuArea, Field, IconButton, Input, Kbd, Modal, type MenuItem } from '../ui'
import { useFilePicker } from '../ui/inputs'
import { hostOf } from './notes-nodes'
import { moodSize, sectionOf, tidyMoodboard, type Box } from './moodLayout'
import { SendTo } from './SendTo'

type MoodNodeData = { item: MoodItemSnapshot; asset: AssetSnapshot | null }
type MoodNodeType = Node<MoodNodeData, 'mood'>

const NOTE_COLORS = [
  { color: '#f2c14e', name: 'Yellow' },
  { color: '#f59ac0', name: 'Pink' },
  { color: '#8cc2f5', name: 'Blue' },
  { color: '#8fdcae', name: 'Green' },
  { color: '#bba6f7', name: 'Purple' },
  { color: '#d4d5dc', name: 'Grey' },
] as const

interface MoodActions {
  resizeStart(id: string): void
  resized(id: string, box: Box): void
  sendTo(assetId: string): void
  remove(id: string): void
}

const MoodActionsContext = createContext<MoodActions | null>(null)
function useMoodActions(): MoodActions {
  const value = useContext(MoodActionsContext)
  if (!value) throw new Error('useMoodActions must be used inside the moodboard')
  return value
}

const nodeTypes = { mood: memo(MoodNode) }

/** Freeform canvas of pictures, links, notes, colours and sections. */
export function Moodboard({ cutId, popout = false }: { cutId: string; popout?: boolean }) {
  return (
    <ReactFlowProvider>
      <MoodboardView cutId={cutId} popout={popout} />
    </ReactFlowProvider>
  )
}

function MoodboardView({ cutId, popout }: { cutId: string; popout: boolean }) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const { projectId } = useProjectContext()
  const flow = useReactFlow<MoodNodeType>()
  const [theme] = useTheme()
  const { undo, redo, canUndo, canRedo } = useUndoRedo()
  const containerRef = useRef<HTMLDivElement>(null)
  const [sendAsset, setSendAsset] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)

  const items = useMemo(() => Object.values(s.moodboard).sort(byCreation), [s.moodboard])

  // ------------------------------------------------------------ node state

  const [nodes, setNodes] = useState<MoodNodeType[]>([])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const busy = useRef(new Set<string>())

  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      let changed = prev.length !== items.length
      const next = items.map((item, i) => {
        const existing = byId.get(item.id)
        const asset = item.assetId ? (s.assets[item.assetId] ?? null) : null
        const held = existing && busy.current.has(item.id)
        const position = held ? existing.position : { x: item.x, y: item.y }
        const width = held ? existing.width : item.w
        const height = held ? existing.height : item.h
        const data = existing && existing.data.item === item && existing.data.asset === asset ? existing.data : { item, asset }
        if (
          existing &&
          existing.data === data &&
          existing.position.x === position.x &&
          existing.position.y === position.y &&
          existing.width === width &&
          existing.height === height
        ) {
          if (prev[i] !== existing) changed = true
          return existing
        }
        changed = true
        return {
          ...existing,
          id: item.id,
          type: 'mood' as const,
          position,
          width,
          height,
          data,
          zIndex: item.kind === 'section' ? -1 : 0,
          selected: existing?.selected ?? false,
        }
      })
      return changed ? next : prev
    })
  }, [items, s.assets])

  const onNodesChange = useCallback(
    (changes: NodeChange<MoodNodeType>[]) => {
      // Moves that aren't part of a drag or resize come from the arrow keys; save them straight away.
      const nudged: Record<string, { x: number; y: number }> = {}
      for (const c of changes) {
        if ((c.type === 'position' && c.dragging) || (c.type === 'dimensions' && c.resizing)) busy.current.add(c.id)
        else if (c.type === 'position' && c.position && !busy.current.has(c.id)) nudged[c.id] = c.position
      }
      setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current))
      if (Object.keys(nudged).length) project.setMoodPositions(nudged)
    },
    [project],
  )

  // -------------------------------------------------------------- dragging

  /** Items riding along with a section being dragged: offset from the section's corner. */
  const carried = useRef(new Map<string, { section: string; dx: number; dy: number }>())

  const onNodeDragStart: OnNodeDrag<MoodNodeType> = useCallback((_event, _node, dragged) => {
    carried.current.clear()
    const draggedIds = new Set(dragged.map((n) => n.id))
    for (const n of dragged) {
      if (n.data.item.kind !== 'section') continue
      const section = { id: n.id, x: n.position.x, y: n.position.y, w: n.width ?? n.data.item.w, h: n.height ?? n.data.item.h }
      for (const other of nodesRef.current) {
        if (draggedIds.has(other.id) || other.data.item.kind === 'section' || carried.current.has(other.id)) continue
        const box = { x: other.position.x, y: other.position.y, w: other.width ?? other.data.item.w, h: other.height ?? other.data.item.h }
        if (sectionOf(box, [section]) === section.id) {
          carried.current.set(other.id, { section: n.id, dx: box.x - section.x, dy: box.y - section.y })
          busy.current.add(other.id)
        }
      }
    }
  }, [])

  const onNodeDrag: OnNodeDrag<MoodNodeType> = useCallback((_event, _node, dragged) => {
    if (!carried.current.size) return
    const positions = new Map(dragged.map((n) => [n.id, n.position]))
    setNodes((current) =>
      current.map((n) => {
        const c = carried.current.get(n.id)
        const p = c && positions.get(c.section)
        return p ? { ...n, position: { x: p.x + c.dx, y: p.y + c.dy } } : n
      }),
    )
  }, [])

  const onNodeDragStop: OnNodeDrag<MoodNodeType> = useCallback(
    (_event, _node, dragged) => {
      const positions: Record<string, { x: number; y: number }> = Object.fromEntries(dragged.map((n) => [n.id, n.position]))
      for (const [id, c] of carried.current) {
        const p = positions[c.section]
        if (p) positions[id] = { x: p.x + c.dx, y: p.y + c.dy }
      }
      for (const id of Object.keys(positions)) busy.current.delete(id)
      carried.current.clear()
      project.setMoodPositions(positions)
    },
    [project],
  )

  const onDelete: OnDelete<MoodNodeType> = useCallback(({ nodes: deleted }) => project.deleteMoodItems(deleted.map((n) => n.id)), [project])

  const actions: MoodActions = useMemo(
    () => ({
      resizeStart: (id) => busy.current.add(id),
      resized: (id, box) => {
        busy.current.delete(id)
        project.updateMoodItem(id, { x: box.x, y: box.y, w: box.w, h: box.h })
      },
      sendTo: (assetId) => setSendAsset(assetId),
      remove: (id) => project.deleteMoodItems([id]),
    }),
    [project],
  )

  // ---------------------------------------------------------------- adding

  /** The middle of what's on screen, in board coordinates. */
  const viewCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [flow])

  const selectOnly = (ids: string[]) =>
    setNodes((current) => current.map((n) => (n.selected === ids.includes(n.id) ? n : { ...n, selected: ids.includes(n.id) })))

  /** Places assets in a row starting at `at` (centred on screen by default). */
  const addAssets = useCallback(
    (assetIds: string[], at?: { x: number; y: number }) => {
      const assets = assetIds.map((id) => project.snapshot().assets[id]).filter((a): a is AssetSnapshot => a !== undefined)
      if (!assets.length) return
      const sizes = assets.map(moodSize)
      const total = sizes.reduce((w, size) => w + size.w + 24, -24)
      const origin = at ?? { x: viewCenter().x - total / 2, y: viewCenter().y - Math.max(...sizes.map((z) => z.h)) / 2 }
      let x = origin.x
      const ids = project.transact(() =>
        assets.map((asset, i) => {
          const { w, h } = sizes[i]!
          const id = project.addMoodItem({ kind: 'asset', assetId: asset.id, x, y: origin.y, w, h })
          x += w + 24
          return id
        }),
      )
      setTimeout(() => selectOnly(ids), 0)
    },
    [project, viewCenter],
  )

  const addFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => addAssets(await importFiles(project, files, user.id), at),
    [project, user.id, addAssets],
  )

  const addLinkItem = useCallback(
    (url: string, at?: { x: number; y: number }) => {
      const { assetId, ready } = addLink(project, url, user.id)
      addAssets([assetId], at)
      // The card grows to fit a preview picture once the page has been read.
      void ready.then(() => {
        const asset = project.snapshot().assets[assetId]
        if (!asset?.preview) return
        const size = moodSize(asset)
        for (const item of Object.values(project.snapshot().moodboard)) {
          if (item.assetId === assetId && item.h < size.h) project.updateMoodItem(item.id, { h: size.h })
        }
      })
    },
    [project, user.id, addAssets],
  )

  const addItem = (kind: 'note' | 'color' | 'section', at?: { x: number; y: number }, text = '') => {
    const size = kind === 'section' ? { w: 640, h: 420 } : kind === 'color' ? { w: 132, h: 150 } : { w: 220, h: 180 }
    const c = at ?? viewCenter()
    const jitter = at ? 0 : Math.round((Math.random() - 0.5) * 60)
    const color = kind === 'color' ? '#8e7dff' : kind === 'note' ? NOTE_COLORS[0].color : '#000000'
    const id = project.addMoodItem({ kind, x: c.x - size.w / 2 + jitter, y: c.y - size.h / 2 + jitter, ...size, color, text })
    setTimeout(() => {
      selectOnly([id])
      if (kind !== 'color') document.querySelector<HTMLElement>(`[data-mood-text="${id}"]`)?.focus()
    }, 50)
  }

  const picker = useFilePicker((files) => void addFiles(files), 'image/*,video/*,audio/*')

  const tidy = () => {
    const boxes = tidyMoodboard(items)
    project.transact(() => {
      for (const [id, box] of Object.entries(boxes)) project.updateMoodItem(id, box)
    })
    setTimeout(() => void flow.fitView({ padding: 0.15, duration: 300 }), 50)
  }

  // ------------------------------------------------- paste, drop, keyboard

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return
      const files = mediaFiles(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      e.preventDefault()
      const url = singleUrl(text)
      if (url) addLinkItem(url)
      else addItem('note', undefined, text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const onDragOver = (e: DragEvent) => {
    if (!isMediaDrag(e.dataTransfer) && !e.dataTransfer.types.includes('text/uri-list')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent) => {
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const files = mediaFiles(e.dataTransfer)
    const assetIds = droppedAssetIds(e.dataTransfer)
    const url = singleUrl(e.dataTransfer.getData('text/uri-list').split('\n')[0])
    if (!files.length && !assetIds.length && !url) return
    e.preventDefault()
    if (files.length) void addFiles(files, at)
    else if (assetIds.length) addAssets(assetIds, at)
    else if (url) addLinkItem(url, at)
  }

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.classList.contains('react-flow__pane')) return
    addItem('note', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  const popOut = () => {
    const url = `${writePath(projectId, { section: 'moodboard', pageId: null })}?window=1`
    const win = window.open(url, `weft-moodboard-${projectId}`, 'popup,width=1280,height=820')
    if (!win) toast('Your browser blocked the new window. Allow pop-ups for this site and try again.', 'error')
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={onDoubleClick}
    >
      <MoodActionsContext.Provider value={actions}>
        <ReactFlow<MoodNodeType>
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onDelete={onDelete}
          deleteKeyCode={['Delete', 'Backspace']}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          nodesConnectable={false}
          colorMode={theme}
          minZoom={0.05}
          maxZoom={3}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--canvas-dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="top-left">
            <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-1 shadow-pop">
              <Button size="sm" variant="ghost" icon={<StickyNote size={14} />} onClick={() => addItem('note')}>
                Note
              </Button>
              <Button size="sm" variant="ghost" icon={<ImagePlus size={14} />} onClick={picker.open}>
                Pictures
              </Button>
              <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => setLinkOpen(true)}>
                Link
              </Button>
              <IconButton size="sm" label="Colour swatch" onClick={() => addItem('color')}>
                <SwatchBook size={15} />
              </IconButton>
              <IconButton size="sm" label="Section" tooltip="Section: a titled area to group things" onClick={() => addItem('section')}>
                <Frame size={15} />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <IconButton size="sm" label="Undo" tooltip={<span>Undo <Kbd>Ctrl Z</Kbd></span>} onClick={undo} disabled={!canUndo}>
                <Undo2 size={15} />
              </IconButton>
              <IconButton size="sm" label="Redo" tooltip={<span>Redo <Kbd>Ctrl Shift Z</Kbd></span>} onClick={redo} disabled={!canRedo}>
                <Redo2 size={15} />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <IconButton size="sm" label="Tidy up" tooltip="Tidy up: line things up in rows, section by section" onClick={tidy} disabled={!items.length}>
                <LayoutGrid size={15} />
              </IconButton>
              <IconButton size="sm" label="Fit to screen" onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 })}>
                <Maximize size={15} />
              </IconButton>
              {!popout && (
                <IconButton size="sm" label="Open in its own window" tooltip="Open in its own window (for a second screen)" onClick={popOut}>
                  <PictureInPicture2 size={15} />
                </IconButton>
              )}
            </div>
          </Panel>
          {items.length === 0 && (
            <Panel position="top-center" className="!top-1/3">
              <div className="max-w-[360px] rounded-xl border border-line bg-panel px-5 py-4 text-center shadow-pop">
                <p className="font-medium text-fg">Collect the look and feel</p>
                <p className="mt-1 text-fg-2">
                  Drop in pictures, videos and links (from your computer or the Library), paste anything, or double-click to write
                  a note.
                </p>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </MoodActionsContext.Provider>
      {picker.input}
      <SendTo assetId={sendAsset} cutId={cutId} onClose={() => setSendAsset(null)} />
      <LinkDialog open={linkOpen} onOpenChange={setLinkOpen} onSubmit={(url) => addLinkItem(url)} />
    </div>
  )
}

// ------------------------------------------------------------------ nodes

const MIN_SIZE: Record<MoodItemSnapshot['kind'], { w: number; h: number }> = {
  asset: { w: 60, h: 40 },
  note: { w: 120, h: 80 },
  color: { w: 72, h: 88 },
  section: { w: 200, h: 140 },
}

function MoodNode({ id, data, selected }: NodeProps<MoodNodeType>) {
  const { item, asset } = data
  const actions = useMoodActions()
  const project = useProject()
  const min = MIN_SIZE[item.kind]
  const picture = item.kind === 'asset' && (asset?.kind === 'image' || asset?.kind === 'video')

  const menu: Array<MenuItem | 'separator'> = []
  if (item.kind === 'asset' && asset) {
    menu.push({ label: 'Send to a frame or the bible…', icon: <Send size={14} />, onSelect: () => actions.sendTo(asset.id) })
    if (asset.kind === 'link' && asset.url) {
      menu.push({ label: 'Open link', icon: <ExternalLink size={14} />, onSelect: () => window.open(asset.url!, '_blank', 'noopener,noreferrer') })
    }
  }
  if (item.kind === 'note') {
    for (const c of NOTE_COLORS) {
      menu.push({
        label: c.name,
        icon: <span className="size-3 rounded-full" style={{ background: c.color }} />,
        checked: item.color === c.color,
        onSelect: () => project.updateMoodItem(id, { color: c.color }),
      })
    }
  }
  if (item.kind === 'color') {
    menu.push({ label: 'Copy colour code', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(item.color.toUpperCase()) })
  }
  if (menu.length) menu.push('separator')
  menu.push({ label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onSelect: () => actions.remove(id) })

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={min.w}
        minHeight={min.h}
        keepAspectRatio={picture}
        color="var(--accent)"
        onResizeStart={() => actions.resizeStart(id)}
        onResizeEnd={(_e, p) => actions.resized(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <ContextMenuArea items={menu}>
        <div className="size-full">
          {item.kind === 'asset' && <AssetBody item={item} asset={asset} selected={selected} />}
          {item.kind === 'note' && <NoteBody item={item} selected={selected} />}
          {item.kind === 'color' && <ColorBody item={item} selected={selected} />}
          {item.kind === 'section' && <SectionBody item={item} selected={selected} />}
        </div>
      </ContextMenuArea>
    </>
  )
}

const frameClass = (selected: boolean) => cx('size-full overflow-hidden rounded-lg shadow-pop', selected && 'ring-2 ring-accent')

function AssetBody({ item, asset, selected }: { item: MoodItemSnapshot; asset: AssetSnapshot | null; selected: boolean }) {
  if (!asset) return <div className={cx(frameClass(selected), 'flex items-center justify-center bg-panel text-fg-3')}>Missing</div>
  if (asset.kind === 'link') {
    const href = asset.url ?? ''
    return (
      <div
        className={cx(frameClass(selected), 'flex flex-col border border-line bg-panel')}
        onDoubleClick={() => href && window.open(href, '_blank', 'noopener,noreferrer')}
        title="Double-click to open"
      >
        {asset.preview && (
          <img src={asset.preview} alt="" referrerPolicy="no-referrer" draggable={false} className="min-h-0 w-full flex-1 object-cover" />
        )}
        <div className="shrink-0 px-3 py-2.5">
          <div className="truncate text-[11px] text-fg-3">{asset.site || hostOf(href)}</div>
          <div className="line-clamp-2 text-[13px] font-medium text-fg">{asset.title && asset.title !== href ? asset.title : hostOf(href)}</div>
        </div>
      </div>
    )
  }
  if (asset.kind === 'audio') {
    return (
      <div className={cx(frameClass(selected), 'flex flex-col justify-center gap-2 border border-line bg-panel px-3')}>
        <div className="flex items-center gap-2 text-fg">
          <AudioLines size={15} className="text-accent-strong" aria-hidden />
          <span className="truncate">{asset.name || 'Audio'}</span>
        </div>
        {asset.hash && <audio src={displayUrl(asset.hash)} controls preload="metadata" className="nodrag h-8 w-full" />}
      </div>
    )
  }
  return (
    <div className={cx(frameClass(selected), 'bg-media')} title={asset.name}>
      <MediaFill media={{ hash: asset.hash, kind: asset.kind, title: asset.name }} />
    </div>
  )
}

function NoteBody({ item, selected }: { item: MoodItemSnapshot; selected: boolean }) {
  const project = useProject()
  return (
    <div className={cx(frameClass(selected), 'flex flex-col')} style={{ background: item.color }}>
      <div className="h-4 shrink-0 cursor-grab" title="Drag to move" />
      <BoundTextarea
        data-mood-text={item.id}
        bindKey={`mood:${item.id}`}
        resolve={() => project.moodText(item.id)}
        placeholder="Write a note"
        aria-label="Note"
        className="nodrag nowheel weft-card-text min-h-0 flex-1 bg-transparent px-3 pb-3 text-[13px] leading-[1.45] text-[#1b1b1f] placeholder:text-black/40 focus:outline-none"
      />
    </div>
  )
}

function ColorBody({ item, selected }: { item: MoodItemSnapshot; selected: boolean }) {
  const project = useProject()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={cx(frameClass(selected), 'flex flex-col border border-line bg-panel')}>
      <button
        type="button"
        onDoubleClick={() => input.current?.click()}
        title="Double-click to change the colour"
        aria-label={`Colour ${item.color}. Double-click to change it`}
        className="min-h-0 flex-1"
        style={{ background: item.color }}
      />
      <div className="flex h-7 shrink-0 items-center justify-between px-2 text-[11px] font-medium text-fg-2 uppercase tabular-nums">
        {item.color}
      </div>
      <input
        ref={input}
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#8e7dff'}
        onChange={(e) => project.updateMoodItem(item.id, { color: e.target.value })}
        className="pointer-events-none absolute bottom-0 left-0 size-0 opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}

function SectionBody({ item, selected }: { item: MoodItemSnapshot; selected: boolean }) {
  const project = useProject()
  return (
    <div
      className={cx(
        'size-full rounded-xl border-2 border-dashed bg-[color-mix(in_srgb,var(--panel)_45%,transparent)]',
        selected ? 'border-accent' : 'border-line-strong',
      )}
    >
      <div className="flex h-11 items-center px-3">
        <BoundInput
          data-mood-text={item.id}
          bindKey={`mood:${item.id}`}
          resolve={() => project.moodText(item.id)}
          placeholder="Section title"
          aria-label="Section title"
          className="nodrag w-full max-w-[420px] truncate rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold text-fg placeholder:text-fg-3 hover:bg-hover focus:bg-bg focus:outline-none"
        />
      </div>
    </div>
  )
}

function LinkDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    onSubmit(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    setUrl('')
    onOpenChange(false)
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add a link" description="YouTube, Vimeo, Instagram, Pinterest or any page. It goes in the Library too.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Web address" htmlFor="mood-link">
          <Input id="mood-link" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!url.trim()}>
            Add link
          </Button>
        </div>
      </form>
    </Modal>
  )
}
