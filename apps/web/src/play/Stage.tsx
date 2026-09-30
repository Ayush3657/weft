import {
  aspectValue,
  cameraMotion,
  composeAt,
  formatDuration,
  type AssetSnapshot,
  type FrameSnapshot,
  type Layer,
  type PlayItem,
  type ProjectSnapshot,
} from '@weft/model'
import { memo, useEffect, useRef } from 'react'
import { mediaUrl } from '../lib/media'
import { useClockTime, type PlaybackClock } from './clock'

export interface Overlays {
  text: boolean
  captions: boolean
  safe: boolean
  info: boolean
}

function heroOf(s: ProjectSnapshot, frame: FrameSnapshot): AssetSnapshot | undefined {
  const version = frame.media.find((m) => m.id === frame.heroMediaId)
  return version ? s.assets[version.assetId] : undefined
}

/** The preview: whatever the cut shows at the clock's current time. */
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

  return (
    <div className="relative flex size-full items-center justify-center" style={{ containerType: 'size' }}>
      <div
        className="relative overflow-hidden rounded-sm bg-black shadow-pop"
        style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: String(aspect) }}
      >
        {comp.layers.map((layer) => {
          const frame = s.frames[layer.frameId]
          const item = items.find((i) => i.frameId === layer.frameId)
          if (!frame || !item) return null
          return (
            <StageLayer
              key={layer.frameId}
              layer={layer}
              frame={frame}
              hero={heroOf(s, frame)}
              item={item}
              label={labels.get(frame.id) ?? ''}
              clock={clock}
            />
          )
        })}
        {comp.fade && <div className="absolute inset-0" style={{ background: comp.fade.color, opacity: comp.fade.opacity }} />}

        {overlays.text && current?.onScreenText.trim() && (
          <div className="pointer-events-none absolute inset-x-[8%] bottom-[16%] text-center text-[clamp(14px,4cqw,44px)] leading-tight font-semibold text-white [text-shadow:0_2px_12px_rgb(0_0_0/0.7)]">
            {current.onScreenText}
          </div>
        )}
        {overlays.captions && vo && (
          <div className="pointer-events-none absolute inset-x-[10%] bottom-[5%] flex justify-center">
            <span className="rounded bg-black/70 px-2 py-1 text-center text-[clamp(11px,2.2cqw,22px)] leading-snug text-white">
              {vo}
            </span>
          </div>
        )}
        {overlays.safe && (
          <>
            <div className="pointer-events-none absolute inset-[5%] border border-white/35" />
            <div className="pointer-events-none absolute inset-[10%] border border-dashed border-white/25" />
          </>
        )}
        {overlays.info && comp.current && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {labels.get(comp.current.frameId) ?? '—'} · {formatDuration(comp.current.duration)}
          </div>
        )}
        {!items.length && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/60">
            Nothing to play in this cut yet.
          </div>
        )}
      </div>
    </div>
  )
}

const StageLayer = memo(function StageLayer({
  layer,
  frame,
  hero,
  item,
  label,
  clock,
}: {
  layer: Layer
  frame: FrameSnapshot
  hero: AssetSnapshot | undefined
  item: PlayItem
  label: string
  clock: PlaybackClock
}) {
  const motion = cameraMotion(frame.movement, layer.progress)
  const transform = `translate(${motion.x * 100}%, ${motion.y * 100}%) scale(${motion.scale}) rotate(${motion.rotate}deg)`
  return (
    <div
      className="absolute inset-0"
      style={{ opacity: layer.opacity, clipPath: layer.reveal < 1 ? `inset(0 ${(1 - layer.reveal) * 100}% 0 0)` : undefined }}
    >
      {hero?.hash && hero.kind === 'image' && (
        <img src={mediaUrl(hero.hash)} alt="" draggable={false} className="size-full object-cover" style={{ transform }} />
      )}
      {hero?.hash && hero.kind === 'video' && <StageVideo hash={hero.hash} item={item} clock={clock} />}
      {!hero?.hash && <Slate label={label} frame={frame} />}
    </div>
  )
})

/** A video frame, kept at the right time for the clock (and scrubbable when paused). */
function StageVideo({ hash, item, clock }: { hash: string; item: PlayItem; clock: PlaybackClock }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => {
      const local = Math.max(0, clock.getTime() - item.start)
      const target = Number.isFinite(el.duration) ? Math.min(local, Math.max(0, el.duration - 0.05)) : local
      if (clock.isPlaying() && local < item.duration) {
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
  return <video ref={ref} src={mediaUrl(hash)} muted playsInline preload="auto" className="size-full object-cover" />
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
