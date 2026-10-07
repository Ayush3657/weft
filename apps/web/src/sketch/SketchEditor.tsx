import {
  SKETCH_COLORS,
  SKETCH_SIZES,
  SKETCH_WIDTH,
  aspectValue,
  cutTimeline,
  shotLabels,
  simplifyPoints,
  sketchHeight,
  strokeHit,
  type AssetSnapshot,
  type SketchStroke,
  type SketchTool,
} from '@weft/model'
import { ArrowUpRight, ChevronLeft, ChevronRight, Eraser, ImageOff, Image as ImageIcon, PenLine, Redo2, Square, Trash2, Undo2, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { displayUrl } from '../lib/media'
import { usePref } from '../lib/prefs'
import { toast } from '../lib/toast'
import { useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, IconButton, Kbd, Tooltip } from '../ui'
import { PAPER, StrokePaths, closeSketch, openSketch, useSketching } from './SketchLayer'

type Tool = SketchTool | 'eraser'
type Backdrop = 'picture' | 'faded' | 'paper'

const TOOLS: ReadonlyArray<{ id: Tool; label: string; hint: string; key: string; icon: LucideIcon }> = [
  { id: 'pen', label: 'Pen', hint: 'Draw', key: 'P', icon: PenLine },
  { id: 'arrow', label: 'Arrow', hint: 'Camera or subject moves; hold Shift for a straight one', key: 'A', icon: ArrowUpRight },
  { id: 'box', label: 'Box', hint: 'A framing, like where a push-in ends', key: 'B', icon: Square },
  { id: 'eraser', label: 'Eraser', hint: 'Rub out whole strokes', key: 'E', icon: Eraser },
]
const TOOL_IDS = TOOLS.map((t) => t.id)
/** The eraser's reach, in sketch units. */
const ERASER = 14

/** The sketch editor, over everything, for whichever frame is being sketched on. */
export function SketchEditorHost({ cutId }: { cutId: string }) {
  const frameId = useSketching()
  const s = useSnapshot()
  useEffect(() => closeSketch, [])
  if (!frameId || !s.frames[frameId]) return null
  return <SketchEditor key={frameId} frameId={frameId} cutId={cutId} />
}

function heroOf(s: ReturnType<typeof useSnapshot>, frameId: string): AssetSnapshot | null {
  const frame = s.frames[frameId]!
  const version = frame.media.find((m) => m.id === frame.heroMediaId)
  const asset = version ? s.assets[version.assetId] : undefined
  return asset?.hash && (asset.kind === 'image' || asset.kind === 'video') ? asset : null
}

interface Drawing {
  pointerId: number
  points: number[]
  pressure: boolean
  straight: boolean
}

function SketchEditor({ frameId, cutId }: { frameId: string; cutId: string }) {
  const s = useSnapshot()
  const { project, undo } = useProjectContext()
  const user = useUser()
  const frame = s.frames[frameId]!
  const aspect = aspectValue(s.meta.aspect)
  const height = sketchHeight(aspect)
  const hero = heroOf(s, frameId)
  const label = shotLabels(s).get(frameId) ?? 'Unlinked frame'

  const [toolPref, setToolPref] = usePref('sketch-tool')
  const tool: Tool = TOOL_IDS.includes(toolPref as Tool) ? (toolPref as Tool) : 'pen'
  const [colorPref, setColorPref] = usePref('sketch-color')
  const color = colorPref && SKETCH_COLORS.some((c) => c.id === colorPref) ? colorPref : hero ? '#e5484d' : '#161616'
  const [sizePref, setSizePref] = usePref('sketch-size')
  const size = SKETCH_SIZES.find((z) => z.id === sizePref) ?? SKETCH_SIZES[1]!
  const [backdrop, setBackdrop] = useState<Backdrop>(hero ? 'picture' : 'paper')
  const shown: Backdrop = hero ? backdrop : 'paper'

  // The frame's box, as big as fits.
  const stageRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => {
      const width = Math.min(el.clientWidth, el.clientHeight * aspect)
      setBox({ width, height: width / aspect })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [aspect])

  const order = cutTimeline(s, cutId).items.map((i) => i.frameId)
  const at = order.indexOf(frameId)
  const go = (step: number) => {
    const next = order[at + step]
    if (at >= 0 && next) openSketch(next)
  }

  const svgRef = useRef<SVGSVGElement>(null)
  const drawing = useRef<Drawing | null>(null)
  const [draft, setDraft] = useState<SketchStroke | null>(null)
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set())
  const [eraserAt, setEraserAt] = useState<{ x: number; y: number } | null>(null)

  const toSketch = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * SKETCH_WIDTH, y: ((e.clientY - rect.top) / rect.height) * height }
  }
  const width = tool === 'pen' ? size.pen : size.line
  const draftOf = (d: Drawing): SketchStroke => ({
    id: 'draft',
    tool: tool as SketchTool,
    color,
    size: width,
    points: d.points,
    pressure: d.pressure,
    createdBy: null,
    createdAt: 0,
  })
  const hitAt = (x: number, y: number, into: Set<string>) => {
    for (const stroke of frame.sketch) if (!into.has(stroke.id) && strokeHit(stroke, x, y, ERASER)) into.add(stroke.id)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toSketch(e)
    if (tool === 'eraser') {
      const hit = new Set<string>()
      hitAt(x, y, hit)
      setErasing(hit)
      drawing.current = { pointerId: e.pointerId, points: [], pressure: false, straight: false }
      return
    }
    // A pen's pressure shapes pen strokes; a mouse's speed does.
    const pressure = tool === 'pen' && e.pointerType === 'pen' && e.pressure > 0
    const d: Drawing = { pointerId: e.pointerId, points: pressure ? [x, y, e.pressure] : [x, y], pressure, straight: tool === 'box' || e.shiftKey }
    drawing.current = d
    setDraft(draftOf(d))
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = toSketch(e)
    if (tool === 'eraser') setEraserAt({ x, y })
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const moves = events.length ? events : [e.nativeEvent]
    if (tool === 'eraser') {
      const next = new Set(erasing)
      for (const ev of moves) {
        const p = toSketch(ev)
        hitAt(p.x, p.y, next)
      }
      if (next.size !== erasing.size) setErasing(next)
      return
    }
    if (d.straight || (tool === 'arrow' && e.shiftKey)) {
      d.points = [d.points[0]!, d.points[1]!, x, y]
      d.pressure = false
    } else {
      for (const ev of moves) {
        const p = toSketch(ev)
        d.points.push(p.x, p.y)
        if (d.pressure) d.points.push(ev.pressure || 0.5)
      }
    }
    setDraft(draftOf(d))
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    drawing.current = null
    if (tool === 'eraser') {
      const ids = [...erasing]
      setErasing(new Set())
      if (ids.length) {
        undo.stopCapturing()
        project.removeStrokes(frameId, ids)
        undo.stopCapturing()
      }
      return
    }
    setDraft(null)
    let points = d.points
    if (tool === 'box') {
      const [x1 = 0, y1 = 0, x2 = x1, y2 = y1] = points
      // A click isn't a box.
      if (Math.abs(x2 - x1) < 6 || Math.abs(y2 - y1) < 6) return
      points = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
    } else {
      points = simplifyPoints(points, d.pressure ? 3 : 2, tool === 'pen' ? 0.35 : 1.2)
      // A click isn't an arrow.
      if (tool === 'arrow' && (points.length < 4 || Math.hypot(points[points.length - 2]! - points[0]!, points[points.length - 1]! - points[1]!) < 12)) return
    }
    // Each stroke is its own step for Ctrl+Z.
    undo.stopCapturing()
    project.addStroke(frameId, { tool: tool as SketchTool, color, size: width, points, pressure: d.pressure, createdBy: user.id })
    undo.stopCapturing()
  }

  const onPointerCancel = () => {
    drawing.current = null
    setDraft(null)
    setErasing(new Set())
  }

  const clear = () => {
    if (!frame.sketch.length) return
    undo.stopCapturing()
    project.clearSketch(frameId)
    undo.stopCapturing()
    toast('Cleared the sketch. Ctrl+Z brings it back.')
  }
  const cycleBackdrop = () => setBackdrop((b) => (b === 'picture' ? 'faded' : b === 'faded' ? 'paper' : 'picture'))

  // Keys go to the sketch, not the board underneath (Ctrl+Z still undoes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      e.stopPropagation()
      const key = e.key.toLowerCase()
      const pick = TOOLS.find((t) => t.key.toLowerCase() === key)
      if (key === 'escape') closeSketch()
      else if (pick) setToolPref(pick.id === 'pen' ? null : pick.id)
      else if (key === '[' || key === ']') {
        const i = SKETCH_SIZES.findIndex((z) => z.id === size.id) + (key === ']' ? 1 : -1)
        const next = SKETCH_SIZES[Math.max(0, Math.min(SKETCH_SIZES.length - 1, i))]!
        setSizePref(next.id === 'm' ? null : next.id)
      } else if (key === 'arrowleft') go(-1)
      else if (key === 'arrowright') go(1)
      else if (key === 'h' && hero) cycleBackdrop()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div role="dialog" aria-modal aria-label={`Sketch on shot ${label}`} className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <IconButton size="sm" label="Previous shot" tooltip={<span>Previous shot <Kbd>←</Kbd></span>} disabled={at <= 0} onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-strong tabular-nums">{label}</span>
        <IconButton size="sm" label="Next shot" tooltip={<span>Next shot <Kbd>→</Kbd></span>} disabled={at < 0 || at >= order.length - 1} onClick={() => go(1)}>
          <ChevronRight size={16} />
        </IconButton>
        <p className="ml-1 min-w-0 flex-1 truncate text-[13px] text-fg-2">{frame.description.trim() || 'No description yet'}</p>
        <Button size="sm" variant="primary" onClick={closeSketch}>
          Done
        </Button>
      </header>

      <div ref={stageRef} className="relative mx-6 mt-4 mb-3 flex min-h-0 flex-1 items-center justify-center">
        <div className="relative overflow-hidden rounded-md shadow-pop" style={{ width: box.width, height: box.height, background: shown === 'paper' ? PAPER : '#000' }}>
          {hero && shown !== 'paper' && (
            <div className="absolute inset-0" style={{ opacity: shown === 'faded' ? 0.3 : 1 }}>
              {hero.kind === 'image' ? (
                <img src={displayUrl(hero.hash!, 1920)} alt="" draggable={false} className="size-full object-cover" />
              ) : (
                <video src={displayUrl(hero.hash!)} muted playsInline preload="auto" className="size-full object-cover" />
              )}
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SKETCH_WIDTH} ${height}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full touch-none select-none"
            style={{ cursor: tool === 'eraser' ? 'none' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setEraserAt(null)}
          >
            {frame.sketch.map((stroke) => (
              <StrokePaths key={stroke.id} stroke={stroke} faded={erasing.has(stroke.id)} />
            ))}
            {draft && <StrokePaths stroke={draft} />}
            {tool === 'eraser' && eraserAt && (
              <circle cx={eraserAt.x} cy={eraserAt.y} r={ERASER} fill="rgb(255 255 255 / 0.2)" stroke="#888" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        </div>
      </div>

      <div role="toolbar" aria-label="Sketch tools" className="mx-auto mb-5 flex items-center gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-pop">
        {TOOLS.map((t) => (
          <Tooltip
            key={t.id}
            side="top"
            content={
              <span>
                {t.label}: {t.hint} <Kbd>{t.key}</Kbd>
              </span>
            }
          >
            <button
              type="button"
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setToolPref(t.id === 'pen' ? null : t.id)}
              className={cx('flex size-9 items-center justify-center rounded-lg transition-colors', tool === t.id ? 'bg-accent text-accent-fg' : 'text-fg-2 hover:bg-hover hover:text-fg')}
            >
              <t.icon size={17} />
            </button>
          </Tooltip>
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        {SKETCH_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            aria-pressed={color === c.id}
            title={c.label}
            onClick={() => setColorPref(c.id)}
            className={cx('flex size-8 items-center justify-center rounded-lg', color === c.id ? 'bg-hover' : 'hover:bg-hover')}
          >
            <span className={cx('size-5 rounded-full border', color === c.id ? 'border-fg ring-2 ring-accent' : 'border-line-strong')} style={{ background: c.id }} />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        {SKETCH_SIZES.map((z) => (
          <Tooltip key={z.id} side="top" content={<span>{z.label} <Kbd>[</Kbd> <Kbd>]</Kbd></span>}>
            <button
              type="button"
              aria-label={z.label}
              aria-pressed={size.id === z.id}
              onClick={() => setSizePref(z.id === 'm' ? null : z.id)}
              className={cx('flex size-8 items-center justify-center rounded-lg', size.id === z.id ? 'bg-hover' : 'hover:bg-hover')}
            >
              <span className="rounded-full bg-fg" style={{ width: 3 + z.pen / 2.4, height: 3 + z.pen / 2.4 }} />
            </button>
          </Tooltip>
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        <IconButton label="Undo" tooltip={<span>Undo <Kbd>Ctrl Z</Kbd></span>} onClick={() => undo.undo()}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="Redo" tooltip={<span>Redo <Kbd>Ctrl Shift Z</Kbd></span>} onClick={() => undo.redo()}>
          <Redo2 size={16} />
        </IconButton>
        {hero && (
          <IconButton
            label={shown === 'picture' ? 'Fade the picture' : shown === 'faded' ? 'Hide the picture' : 'Show the picture'}
            tooltip={<span>{shown === 'picture' ? 'Fade the picture' : shown === 'faded' ? 'Hide the picture' : 'Show the picture'} <Kbd>H</Kbd></span>}
            onClick={cycleBackdrop}
          >
            {shown === 'paper' ? <ImageOff size={16} /> : <ImageIcon size={16} className={shown === 'faded' ? 'opacity-50' : undefined} />}
          </IconButton>
        )}
        <IconButton label="Clear the sketch" tooltip="Clear the sketch" disabled={!frame.sketch.length} onClick={clear}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  )
}
