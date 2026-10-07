import { formatSeconds, indexAt, type PlayItem } from '@weft/model'
import {
  Captions,
  Info,
  Pause,
  PenLine,
  Play,
  Repeat,
  ScanLine,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useState } from 'react'
import { IconButton, Kbd } from '../ui'
import { useClockPlaying, useClockTime, useClockValue, type PlaybackClock } from './clock'
import type { Overlays } from './Stage'

/** Jumps to the start of the current shot, or the previous one if already near its start. */
export function previousShot(clock: PlaybackClock, items: readonly PlayItem[]): void {
  const t = clock.getTime()
  const i = indexAt(items, t)
  const cur = items[i]
  if (cur && t - cur.start > 0.5) clock.seek(cur.start)
  else clock.seek(items[Math.max(0, i - 1)]?.start ?? 0)
}

export function nextShot(clock: PlaybackClock, items: readonly PlayItem[]): void {
  const next = items[indexAt(items, clock.getTime()) + 1]
  clock.seek(next ? next.start : clock.getDuration())
}

/** The only part of the transport that updates every frame. */
function TimeReadout({ clock }: { clock: PlaybackClock }) {
  const t = useClockTime(clock)
  const total = useClockValue(clock, clock.getDuration)
  return (
    <div className="ml-2 text-[13px] tabular-nums">
      <span className="font-medium text-fg">{formatSeconds(t)}</span>
      <span className="text-fg-3"> / {formatSeconds(total)}</span>
    </div>
  )
}

export function Transport({
  clock,
  items,
  overlays,
  onOverlay,
  muted,
  onMuted,
}: {
  clock: PlaybackClock
  items: readonly PlayItem[]
  overlays: Overlays
  onOverlay: (key: keyof Overlays, value: boolean) => void
  muted: boolean
  onMuted: (value: boolean) => void
}) {
  const playing = useClockPlaying(clock)
  const [loop, setLoop] = useState(clock.loop)

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-3">
      <div className="flex items-center gap-0.5">
        <IconButton label="Go to start" tooltip={<span>Go to start <Kbd>Home</Kbd></span>} onClick={() => clock.seek(0)}>
          <SkipBack size={16} />
        </IconButton>
        <IconButton label="Previous shot" tooltip={<span>Previous shot <Kbd>↑</Kbd></span>} onClick={() => previousShot(clock, items)}>
          <StepBack size={16} />
        </IconButton>
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          className="mx-1 flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg hover:bg-accent-strong"
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="translate-x-px" />}
        </button>
        <IconButton label="Next shot" tooltip={<span>Next shot <Kbd>↓</Kbd></span>} onClick={() => nextShot(clock, items)}>
          <StepForward size={16} />
        </IconButton>
        <IconButton label="Go to end" tooltip={<span>Go to end <Kbd>End</Kbd></span>} onClick={() => clock.seek(clock.getDuration())}>
          <SkipForward size={16} />
        </IconButton>
      </div>

      <TimeReadout clock={clock} />

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          label={loop ? 'Loop is on' : 'Loop is off'}
          active={loop}
          onClick={() => {
            clock.loop = !loop
            setLoop(!loop)
          }}
        >
          <Repeat size={15} />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton label="On-screen text" active={overlays.text} onClick={() => onOverlay('text', !overlays.text)}>
          <Type size={15} />
        </IconButton>
        <IconButton label="VO captions" active={overlays.captions} onClick={() => onOverlay('captions', !overlays.captions)}>
          <Captions size={15} />
        </IconButton>
        <IconButton label="Safe-area guides" active={overlays.safe} onClick={() => onOverlay('safe', !overlays.safe)}>
          <ScanLine size={15} />
        </IconButton>
        <IconButton label="Shot number" active={overlays.info} onClick={() => onOverlay('info', !overlays.info)}>
          <Info size={15} />
        </IconButton>
        <IconButton label="Sketches" active={overlays.sketch} onClick={() => onOverlay('sketch', !overlays.sketch)}>
          <PenLine size={15} />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton label={muted ? 'Sound is off' : 'Sound is on'} active={muted} onClick={() => onMuted(!muted)}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </IconButton>
      </div>
    </div>
  )
}
