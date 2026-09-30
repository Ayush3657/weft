import {
  TRANSITIONS,
  findOption,
  formatDuration,
  formatSeconds,
  musicClip,
  voClips,
  type PlayItem,
  type ProjectSnapshot,
} from '@weft/model'
import { Maximize2, Mic, Music, Plus, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { cx } from '../lib/cx'
import { mediaUrl } from '../lib/media'
import { useProject } from '../project/hooks'
import { Button, IconButton, Kbd } from '../ui'
import type { PlaybackClock } from './clock'

const HEADER_WIDTH = 108
const RULER_HEIGHT = 24
const TRACK = { picture: 58, vo: 30, text: 24, music: 30 }
const MIN_PPS = 4
const MAX_PPS = 400
/** How close (in pixels) a dragged edge has to get to a beat to snap to it. */
const SNAP_PX = 8

function withTrim(items: readonly PlayItem[], trim: { frameId: string; duration: number } | null): PlayItem[] {
  if (!trim) return [...items]
  let shift = 0
  return items.map((item) => {
    const start = item.start + shift
    let duration = item.duration
    if (item.frameId === trim.frameId) {
      shift += trim.duration - item.duration
      duration = trim.duration
    }
    return { ...item, start, duration, end: start + duration }
  })
}

function tickStep(pps: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  return steps.find((s) => s * pps >= 72) ?? 600
}

export function Timeline({
  s,
  cutId,
  items,
  clock,
  labels,
  onTrim,
  onAddMusic,
  onAddBeat,
}: {
  s: ProjectSnapshot
  cutId: string
  items: readonly PlayItem[]
  clock: PlaybackClock
  labels: ReadonlyMap<string, string>
  onTrim: (frameId: string, seconds: number) => void
  onAddMusic: (file: File) => void
  onAddBeat: () => void
}) {
  const project = useProject()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const [trim, setTrim] = useState<{ frameId: string; duration: number } | null>(null)
  const [musicDrag, setMusicDrag] = useState<number | null>(null)
  const trimRef = useRef(trim)
  trimRef.current = trim
  const musicInput = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const total = items.at(-1)?.end ?? 0
  const fit = total > 0 && viewWidth > 0 ? Math.min(MAX_PPS, Math.max(MIN_PPS, (viewWidth - 48) / total)) : 40
  const pps = zoom ?? fit
  const cut = s.cuts[cutId]
  const beats = cut?.beats ?? []
  const display = useMemo(() => withTrim(items, trim), [items, trim])
  const vo = useMemo(() => voClips(s, display), [s, display])
  const music = musicClip(s, cutId)
  const musicStart = musicDrag ?? music?.start ?? 0
  const musicAsset = music ? s.assets[music.assetId] : undefined
  const end = Math.max(display.at(-1)?.end ?? 0, music ? musicStart + music.duration : 0)
  const contentWidth = Math.max(viewWidth, end * pps + 160)
  const tracksHeight = TRACK.picture + TRACK.vo + TRACK.text + TRACK.music

  // Ctrl + wheel zooms around the pointer (a native listener, so the page itself doesn't zoom).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const at = (x + el.scrollLeft) / pps
      const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      setZoom(next)
      requestAnimationFrame(() => {
        el.scrollLeft = at * next - x
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pps])

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!
    return (clientX - el.getBoundingClientRect().left + el.scrollLeft) / pps
  }

  /** Press on the ruler or a track to seek; keep holding to scrub. */
  const scrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    clock.seek(timeAt(e.clientX))
    const move = (ev: PointerEvent) => clock.seek(timeAt(ev.clientX))
    const up = () => {
      target.removeEventListener('pointermove', move)
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up, { once: true })
    target.addEventListener('pointercancel', up, { once: true })
  }

  /** Drag a clip's right edge: snaps to beats, otherwise to tenths of a second. */
  const startTrim = (e: ReactPointerEvent<HTMLElement>, item: PlayItem) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    setTrim({ frameId: item.frameId, duration: item.duration })
    const move = (ev: PointerEvent) => {
      let edge = timeAt(ev.clientX)
      const beat = beats.find((b) => Math.abs(b - edge) * pps < SNAP_PX && b > item.start)
      edge = beat ?? Math.round(edge * 10) / 10
      setTrim({ frameId: item.frameId, duration: Math.min(600, Math.max(0.2, edge - item.start)) })
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      const result = trimRef.current
      setTrim(null)
      if (result && Math.abs(result.duration - item.duration) > 0.001) onTrim(item.frameId, result.duration)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up, { once: true })
    target.addEventListener('pointercancel', () => setTrim(null), { once: true })
  }

  /** Drag the music bar sideways to change where the track starts. */
  const startMusicDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !music) return
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const origin = e.clientX
    const from = music.start
    let latest = from
    const move = (ev: PointerEvent) => {
      latest = Math.round((from + (ev.clientX - origin) / pps) * 10) / 10
      setMusicDrag(latest)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      setMusicDrag(null)
      if (latest !== from) project.setMusicOffset(cutId, latest)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up, { once: true })
  }

  const step = tickStep(pps)
  const ticks: number[] = []
  for (let t = 0; t * pps <= contentWidth; t += step) ticks.push(Math.round(t * 1000) / 1000)

  return (
    <section className="flex h-[236px] shrink-0 flex-col border-t border-line bg-panel" aria-label="Timeline">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="px-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Timeline</span>
        <IconButton size="sm" label="Zoom out" onClick={() => setZoom(Math.max(MIN_PPS, pps / 1.5))}>
          <ZoomOut size={14} />
        </IconButton>
        <IconButton size="sm" label="Zoom in" onClick={() => setZoom(Math.min(MAX_PPS, pps * 1.5))}>
          <ZoomIn size={14} />
        </IconButton>
        <IconButton size="sm" label="Fit the whole cut" active={zoom === null} onClick={() => setZoom(null)}>
          <Maximize2 size={14} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={onAddBeat} title="Add a beat marker at the playhead (B)">
          Beat
        </Button>
        {beats.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => project.clearBeats(cutId)}>
            Clear {beats.length} {beats.length === 1 ? 'beat' : 'beats'}
          </Button>
        )}
        <span className="ml-auto hidden text-[11px] text-fg-3 lg:block">
          Drag a clip's right edge to change its length · tap <Kbd>B</Kbd> to mark beats while it plays
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-line" style={{ width: HEADER_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} />
          <TrackHeader height={TRACK.picture} label="Picture" />
          <TrackHeader height={TRACK.vo} label="Voiceover" />
          <TrackHeader height={TRACK.text} label="Text" />
          <div className="flex items-center gap-0.5 border-t border-line px-2" style={{ height: TRACK.music }}>
            <span className="flex-1 text-[11px] text-fg-2">Music</span>
            <IconButton size="sm" label={music ? 'Replace music' : 'Add music'} onClick={() => musicInput.current?.click()} className="size-6">
              <Upload size={12} />
            </IconButton>
            {music && (
              <IconButton size="sm" label="Remove music" onClick={() => project.setCutMusic(cutId, null)} className="size-6">
                <X size={12} />
              </IconButton>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width: contentWidth, height: RULER_HEIGHT + tracksHeight }}>
            {/* Ruler */}
            <div className="absolute inset-x-0 top-0 cursor-col-resize border-b border-line select-none" style={{ height: RULER_HEIGHT }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: t * pps }}>
                  <div className="h-2 w-px bg-line-strong" />
                  <span className="absolute top-2 left-1 text-[10px] whitespace-nowrap text-fg-3 tabular-nums">{formatSeconds(t)}</span>
                </div>
              ))}
              {beats.map((b) => (
                <button
                  key={b}
                  type="button"
                  title="Beat (Alt+click to remove)"
                  onPointerDown={(e) => {
                    if (e.altKey) {
                      e.stopPropagation()
                      project.removeBeat(cutId, b, 0.001)
                    }
                  }}
                  className="absolute bottom-0 size-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 bg-warn"
                  style={{ left: b * pps }}
                  aria-label={`Beat at ${formatSeconds(b)}`}
                />
              ))}
            </div>

            {/* Tracks */}
            <div className="absolute inset-x-0" style={{ top: RULER_HEIGHT, height: tracksHeight }} onPointerDown={scrub}>
              <div className="absolute inset-x-0 top-0" style={{ height: TRACK.picture }}>
                {display.map((item) => (
                  <PictureClip
                    key={item.frameId}
                    s={s}
                    item={item}
                    pps={pps}
                    label={labels.get(item.frameId) ?? ''}
                    trimming={trim?.frameId === item.frameId}
                    onTrimStart={startTrim}
                  />
                ))}
              </div>

              <div className="absolute inset-x-0 border-t border-line" style={{ top: TRACK.picture, height: TRACK.vo }}>
                {display.map((item) => {
                  const frame = s.frames[item.frameId]
                  const text = frame?.audio.map((l) => l.text.trim()).filter(Boolean).join(' ')
                  if (!text || vo.some((c) => c.key.startsWith(`${item.frameId}:`))) return null
                  return (
                    <div
                      key={item.frameId}
                      className="absolute top-1 bottom-1 overflow-hidden rounded border border-dashed border-line-strong px-1.5 text-[11px] leading-[20px] whitespace-nowrap text-fg-2 italic"
                      style={{ left: item.start * pps + 1, width: Math.max(2, item.duration * pps - 2) }}
                      title={`${text} (not recorded yet)`}
                    >
                      {text}
                    </div>
                  )
                })}
                {vo.map((clip) => (
                  <div
                    key={clip.key}
                    className="absolute top-1 bottom-1 flex items-center gap-1 overflow-hidden rounded bg-accent-soft px-1.5 text-[11px] whitespace-nowrap text-accent-strong"
                    style={{ left: clip.start * pps + 1, width: Math.max(2, clip.duration * pps - 2) }}
                    title={`Recorded VO · ${formatDuration(clip.duration)}`}
                  >
                    <Mic size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{formatDuration(clip.duration)}</span>
                  </div>
                ))}
              </div>

              <div className="absolute inset-x-0 border-t border-line" style={{ top: TRACK.picture + TRACK.vo, height: TRACK.text }}>
                {display.map((item) => {
                  const text = s.frames[item.frameId]?.onScreenText.trim()
                  if (!text) return null
                  return (
                    <div
                      key={item.frameId}
                      className="absolute top-1 bottom-1 overflow-hidden rounded bg-hover px-1.5 text-[10.5px] leading-[16px] whitespace-nowrap text-fg-2"
                      style={{ left: item.start * pps + 1, width: Math.max(2, item.duration * pps - 2) }}
                      title={text}
                    >
                      {text}
                    </div>
                  )
                })}
              </div>

              <div className="absolute inset-x-0 border-t border-line" style={{ top: TRACK.picture + TRACK.vo + TRACK.text, height: TRACK.music }}>
                {music ? (
                  <div
                    onPointerDown={startMusicDrag}
                    className="absolute top-1 bottom-1 flex cursor-grab items-center gap-1.5 overflow-hidden rounded bg-warn-soft px-2 text-[11px] whitespace-nowrap text-warn active:cursor-grabbing"
                    style={{ left: musicStart * pps, width: Math.max(4, music.duration * pps) }}
                    title="Drag to move where the music starts"
                  >
                    <Music size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{musicAsset?.name || 'Music'}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => musicInput.current?.click()}
                    className="absolute top-1 bottom-1 left-1 flex items-center gap-1.5 rounded border border-dashed border-line-strong px-2 text-[11px] text-fg-3 hover:text-fg-2"
                  >
                    <Music size={11} aria-hidden /> Add a music track
                  </button>
                )}
              </div>
            </div>

            {/* Beat lines across the tracks */}
            {beats.map((b) => (
              <div
                key={b}
                className="pointer-events-none absolute w-px bg-warn/45"
                style={{ left: b * pps, top: RULER_HEIGHT, height: tracksHeight }}
              />
            ))}

            <Playhead clock={clock} pps={pps} scrollRef={scrollRef} height={RULER_HEIGHT + tracksHeight} />
          </div>
        </div>
      </div>
      <input
        ref={musicInput}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onAddMusic(file)
        }}
      />
    </section>
  )
}

function TrackHeader({ height, label }: { height: number; label: string }) {
  return (
    <div className="flex items-center border-t border-line px-2 text-[11px] text-fg-2 first-of-type:border-t-0" style={{ height }}>
      {label}
    </div>
  )
}

function PictureClip({
  s,
  item,
  pps,
  label,
  trimming,
  onTrimStart,
}: {
  s: ProjectSnapshot
  item: PlayItem
  pps: number
  label: string
  trimming: boolean
  onTrimStart: (e: ReactPointerEvent<HTMLElement>, item: PlayItem) => void
}) {
  const frame = s.frames[item.frameId]
  const version = frame?.media.find((m) => m.id === frame.heroMediaId)
  const hero = version ? s.assets[version.assetId] : undefined
  const width = Math.max(3, item.duration * pps - 2)
  const transition = item.transitionIn ? findOption(TRANSITIONS, item.transitionIn.type)?.label : null
  return (
    <div
      className={cx(
        'absolute top-1 bottom-1 flex overflow-hidden rounded-md border bg-raised',
        trimming ? 'border-accent' : 'border-line-strong',
      )}
      style={{ left: item.start * pps + 1, width }}
      title={`${label} · ${formatDuration(item.duration)}${frame?.description ? ` · ${frame.description}` : ''}`}
    >
      {hero?.hash && hero.kind === 'image' && (
        <img src={mediaUrl(hero.hash)} alt="" draggable={false} className="h-full w-[88px] shrink-0 object-cover" />
      )}
      {hero?.hash && hero.kind === 'video' && (
        <video src={mediaUrl(hero.hash)} muted preload="metadata" className="h-full w-[88px] shrink-0 object-cover" />
      )}
      <div className="min-w-0 flex-1 px-1.5 py-1">
        <div className="flex items-center gap-1 text-[10.5px] font-semibold text-fg tabular-nums">
          <span className="truncate">{label || '—'}</span>
          <span className="ml-auto font-normal text-fg-3">{formatDuration(item.duration)}</span>
        </div>
        <p className="truncate text-[10.5px] text-fg-2">{frame?.description}</p>
      </div>
      {transition && (
        <span
          className="absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-accent"
          title={transition}
          aria-label={transition}
        />
      )}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Change the length of ${label}`}
        onPointerDown={(e) => onTrimStart(e, item)}
        className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize hover:bg-accent/40"
      />
    </div>
  )
}

/** Drawn outside React's render loop: it moves every frame during playback. */
function Playhead({
  clock,
  pps,
  scrollRef,
  height,
}: {
  clock: PlaybackClock
  pps: number
  scrollRef: RefObject<HTMLDivElement | null>
  height: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const update = () => {
      const x = clock.getTime() * pps
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`
      const el = scrollRef.current
      if (el && clock.isPlaying()) {
        if (x > el.scrollLeft + el.clientWidth - 48) el.scrollLeft = x - 48
        else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 48)
      }
    }
    update()
    return clock.subscribe(update)
  }, [clock, pps, scrollRef])
  return (
    <div ref={ref} className="pointer-events-none absolute top-0 left-0 z-20 w-px bg-danger" style={{ height }}>
      <span className="absolute -top-px -left-[5px] block size-[11px] rounded-b-sm bg-danger" />
    </div>
  )
}
