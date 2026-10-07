import {
  aspectValue,
  cameraMotion,
  composeAt,
  formatDuration,
  indexAt,
  type AssetSnapshot,
  type FrameSnapshot,
  type Layer,
  type PlayItem,
  type ProjectSnapshot,
} from '@weft/model'
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { displayUrl } from '../lib/media'
import { PAPER, SketchLayer } from '../sketch/SketchLayer'
import { useClockTime, type PlaybackClock } from './clock'

export interface Overlays {
  text: boolean
  captions: boolean
  safe: boolean
  info: boolean
  sketch: boolean
}

/** Frames kept loaded ahead of the playhead, so each picture is ready before the cut to it. */
const LOOKAHEAD = 3
const STAGE_SIZE = 1920

type Ready = (frameId: string, key: string) => void

function heroOf(s: ProjectSnapshot, frame: FrameSnapshot): AssetSnapshot | undefined {
  const version = frame.media.find((m) => m.id === frame.heroMediaId)
  return version ? s.assets[version.assetId] : undefined
}

/** What has to load before a frame can be shown: its picture or clip. Null for a slate. */
function pictureKey(hero: AssetSnapshot | undefined): string | null {
  if (!hero?.hash) return null
  if (hero.kind === 'image') return displayUrl(hero.hash, STAGE_SIZE)
  if (hero.kind === 'video') return `video:${hero.hash}`
  return null
}

/**
 * The preview: whatever the cut shows at the clock's current time. The next
 * few frames are kept loaded (unseen) so their pictures are decoded before
 * the cut, and a picture that still isn't ready keeps the last one on screen
 * rather than showing black.
 */
export function Stage({
  s,
  items,
  clock,
  labels,
  overlays,
}: {
  s: ProjectSnapshot
  items: readonly PlayItem[]
  clock: PlaybackClock
  labels: ReadonlyMap<string, string>
  overlays: Overlays
}) {
  const t = useClockTime(clock)
  const comp = composeAt(items, t)
  const aspect = aspectValue(s.meta.aspect)
  const current = comp.current ? s.frames[comp.current.frameId] : undefined
  const vo = current?.audio
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(' ')

  // Which picture each mounted frame has ready (loaded and decoded).
  const ready = useRef(new Map<string, string>())
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const onReady = useCallback<Ready>((frameId, key) => {
    if (ready.current.get(frameId) === key) return
    ready.current.set(frameId, key)
    rerender()
  }, [])
  const onGone = useCallback((frameId: string) => void ready.current.delete(frameId), [])
  const isReady = (frameId: string) => {
    const frame = s.frames[frameId]
    const key = frame ? pictureKey(heroOf(s, frame)) : null
    return key === null || ready.current.get(frameId) === key
  }

  // The last fully ready picture stays up until the new one is.
  const held = useRef<readonly Layer[]>([])
  if (comp.layers.every((l) => isReady(l.frameId))) held.current = comp.layers
  const shown = held.current.some((l) => s.frames[l.frameId]) ? held.current : comp.layers

  const mounted: string[] = []
  const mount = (frameId: string) => {
    if (s.frames[frameId] && !mounted.includes(frameId)) mounted.push(frameId)
  }
  for (const layer of shown) mount(layer.frameId)
  for (const layer of comp.layers) mount(layer.frameId)
  const at = indexAt(items, t)
  for (let k = Math.max(0, at - 1); k <= Math.min(items.length - 1, at + LOOKAHEAD); k++) mount(items[k]!.frameId)
  const itemOf = new Map(items.map((item) => [item.frameId, item]))
  const order = (frameId: string) => itemOf.get(frameId)?.index ?? Number.MAX_SAFE_INTEGER
  mounted.sort((a, b) => order(a) - order(b))

  useWarmPictures(items, s)

  return (
    <div className="relative flex size-full items-center justify-center" style={{ containerType: 'size' }}>
      <div
        className="relative overflow-hidden rounded-sm bg-black shadow-pop"
        style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: String(aspect) }}
      >
        {mounted.map((frameId) => {
          const frame = s.frames[frameId]!
          const item = itemOf.get(frameId)
          if (!item) return null
          const index = shown.findIndex((l) => l.frameId === frameId)
          return (
            <StageLayer
              key={frameId}
              layer={index >= 0 ? shown[index]! : null}
              z={index + 1}
              frame={frame}
              hero={heroOf(s, frame)}
              item={item}
              label={labels.get(frame.id) ?? ''}
              clock={clock}
              aspect={aspect}
              showSketch={overlays.sketch}
              onReady={onReady}
              onGone={onGone}
            />
          )
        })}
        {comp.fade && <div className="absolute inset-0 z-10" style={{ background: comp.fade.color, opacity: comp.fade.opacity }} />}

        {overlays.text && current?.onScreenText.trim() && (
          <div className="pointer-events-none absolute inset-x-[8%] bottom-[16%] z-20 text-center text-[clamp(14px,4cqw,44px)] leading-tight font-semibold text-white [text-shadow:0_2px_12px_rgb(0_0_0/0.7)]">
            {current.onScreenText}
          </div>
        )}
        {overlays.captions && vo && (
          <div className="pointer-events-none absolute inset-x-[10%] bottom-[5%] z-20 flex justify-center">
            <span className="rounded bg-black/70 px-2 py-1 text-center text-[clamp(11px,2.2cqw,22px)] leading-snug text-white">
              {vo}
            </span>
          </div>
        )}
        {overlays.safe && (
          <>
            <div className="pointer-events-none absolute inset-[5%] z-20 border border-white/35" />
            <div className="pointer-events-none absolute inset-[10%] z-20 border border-dashed border-white/25" />
          </>
        )}
        {overlays.info && comp.current && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-20 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {labels.get(comp.current.frameId) ?? '—'} · {formatDuration(comp.current.duration)}
          </div>
        )}
        {!items.length && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center text-white/60">
            Nothing to play in this cut yet.
          </div>
        )}
      </div>
    </div>
  )
}

/** A frame on the stage. `layer` is null while it waits unseen, loading, for its turn. */
const StageLayer = memo(function StageLayer({
  layer,
  z,
  frame,
  hero,
  item,
  label,
  clock,
  aspect,
  showSketch,
  onReady,
  onGone,
}: {
  layer: Layer | null
  z: number
  frame: FrameSnapshot
  hero: AssetSnapshot | undefined
  item: PlayItem
  label: string
  clock: PlaybackClock
  aspect: number
  showSketch: boolean
  onReady: Ready
  onGone: (frameId: string) => void
}) {
  const key = pictureKey(hero)
  const [failed, setFailed] = useState<string | null>(null)
  const onFail = useCallback(
    (frameId: string, failedKey: string) => {
      // Shown as a slate rather than waited for.
      setFailed(failedKey)
      onReady(frameId, failedKey)
    },
    [onReady],
  )
  useEffect(() => () => onGone(frame.id), [frame.id, onGone])

  const motion = cameraMotion(frame.movement, layer?.progress ?? 0)
  const transform = `translate(${motion.x * 100}%, ${motion.y * 100}%) scale(${motion.scale}) rotate(${motion.rotate}deg)`
  const usable = key !== null && failed !== key
  const sketched = showSketch && frame.sketch.length > 0
  return (
    <div
      className="absolute inset-0"
      aria-hidden={layer ? undefined : true}
      style={{
        zIndex: z,
        opacity: layer ? layer.opacity : 0,
        clipPath: layer && layer.reveal < 1 ? `inset(0 ${(1 - layer.reveal) * 100}% 0 0)` : undefined,
      }}
    >
      {usable && hero?.kind === 'image' && (
        <StagePicture frameId={frame.id} url={key} transform={transform} onReady={onReady} onFail={onFail} />
      )}
      {usable && hero?.kind === 'video' && hero.hash && (
        <StageVideo frameId={frame.id} readyKey={key} hash={hero.hash} item={item} clock={clock} onReady={onReady} onFail={onFail} />
      )}
      {!usable && (sketched ? <div className="absolute inset-0" style={{ background: PAPER }} /> : <Slate label={label} frame={frame} />)}
      {sketched && (
        // The sketch moves with a still picture (or the paper) as the camera move plays.
        <div className="absolute inset-0" style={{ transform: usable && hero?.kind === 'video' ? undefined : transform }}>
          <SketchLayer strokes={frame.sketch} aspect={aspect} />
        </div>
      )}
    </div>
  )
})

/** A still, decoded before it's shown so the cut to it doesn't flash black. */
function StagePicture({
  frameId,
  url,
  transform,
  onReady,
  onFail,
}: {
  frameId: string
  url: string
  transform: string
  onReady: Ready
  onFail: Ready
}) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    el.decode().then(
      () => live && onReady(frameId, url),
      () => live && onFail(frameId, url),
    )
    return () => {
      live = false
    }
  }, [frameId, url, onReady, onFail])
  return <img ref={ref} src={url} alt="" draggable={false} decoding="sync" className="size-full object-cover" style={{ transform }} />
}

/** A video frame, kept at the right time for the clock (and scrubbable when paused). */
function StageVideo({
  frameId,
  readyKey,
  hash,
  item,
  clock,
  onReady,
  onFail,
}: {
  frameId: string
  readyKey: string
  hash: string
  item: PlayItem
  clock: PlaybackClock
  onReady: Ready
  onFail: Ready
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => {
      const local = clock.getTime() - item.start
      const end = Math.min(item.duration, Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.05) : Infinity)
      const target = Math.min(Math.max(0, local), end)
      // Only the frame being played runs; the ones waiting their turn sit on their first frame.
      if (clock.isPlaying() && local >= 0 && local < item.duration) {
        if (el.paused) {
          el.currentTime = target
          void el.play().catch(() => undefined)
        } else if (Math.abs(el.currentTime - target) > 0.25) {
          el.currentTime = target
        }
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target
      }
    }
    sync()
    return clock.subscribe(sync)
  }, [clock, item.start, item.duration])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const loaded = () => onReady(frameId, readyKey)
    const failed = () => onFail(frameId, readyKey)
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) loaded()
    el.addEventListener('loadeddata', loaded)
    el.addEventListener('error', failed)
    return () => {
      el.removeEventListener('loadeddata', loaded)
      el.removeEventListener('error', failed)
    }
  }, [frameId, readyKey, onReady, onFail])
  return <video ref={ref} src={displayUrl(hash)} muted playsInline preload="auto" className="size-full object-cover" />
}

/** Stand-in for a frame without an image, so the animatic still reads. */
function Slate({ label, frame }: { label: string; frame: FrameSnapshot }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[2cqh] bg-[#16161b] p-[6%] text-center">
      <span className="rounded border border-white/15 px-2 py-0.5 text-[clamp(11px,1.8cqw,18px)] font-semibold text-white/60">
        {label || 'Frame'}
      </span>
      <p className="max-w-[85%] text-[clamp(13px,3cqw,34px)] leading-snug font-medium text-white/85">
        {frame.description.trim() || 'No description yet'}
      </p>
    </div>
  )
}

// ------------------------------------------------------------- warming up

/** Pictures this page has already fetched once, so they come from the browser's cache. */
const warmed = new Set<string>()

/**
 * Fetches every picture in the cut in the background, two at a time and
 * after anything more urgent, so the server makes each preview and the
 * browser has it well before the playhead gets there.
 */
function useWarmPictures(items: readonly PlayItem[], s: ProjectSnapshot) {
  const urls: string[] = []
  for (const item of items) {
    const frame = s.frames[item.frameId]
    const hero = frame ? heroOf(s, frame) : undefined
    const url = hero?.kind === 'image' ? pictureKey(hero) : null
    if (url && !url.startsWith('blob:') && !urls.includes(url)) urls.push(url)
  }
  const wanted = urls.join(' ')
  useEffect(() => {
    if (!wanted) return
    const queue = wanted.split(' ')
    let stopped = false
    const worker = async () => {
      while (!stopped && queue.length) {
        const url = queue.shift()!
        if (warmed.has(url)) continue
        try {
          const res = await fetch(url, { credentials: 'same-origin', priority: 'low' } as RequestInit)
          if (res.ok) {
            await res.blob()
            warmed.add(url)
          }
        } catch {
          // The player loads it again when it's needed.
        }
      }
    }
    void worker()
    void worker()
    return () => {
      stopped = true
    }
  }, [wanted])
}
