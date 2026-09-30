import {
  formatDuration,
  formatSeconds,
  indexAt,
  type AssetSnapshot,
  type FrameSnapshot,
  type PlayItem,
  type ProjectSnapshot,
  type TimelineItem,
} from '@weft/model'
import { Eye, EyeOff, Film, Loader2, Mic, Square, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef } from 'react'
import { cx } from '../lib/cx'
import { mediaUrl } from '../lib/media'
import { BoundTextarea } from '../project/BoundText'
import { useProject } from '../project/hooks'
import { IconButton } from '../ui'
import { useClockPlaying, useClockValue, type PlaybackClock } from './clock'
import type { RecorderState } from './recorder'

function heroOf(s: ProjectSnapshot, frame: FrameSnapshot): AssetSnapshot | undefined {
  const version = frame.media.find((m) => m.id === frame.heroMediaId)
  return version ? s.assets[version.assetId] : undefined
}

export function ShotList({
  s,
  cutId,
  timelineItems,
  items,
  clock,
  labels,
  recorder,
  onRecord,
  onStopRecording,
}: {
  s: ProjectSnapshot
  cutId: string
  /** Every frame in the cut, hidden ones included. */
  timelineItems: readonly TimelineItem[]
  /** The frames that actually play. */
  items: readonly PlayItem[]
  clock: PlaybackClock
  labels: ReadonlyMap<string, string>
  recorder: RecorderState
  onRecord: (frameId: string) => void
  onStopRecording: () => void
}) {
  const index = useClockValue(clock, () => indexAt(items, clock.getTime()))
  const playing = useClockPlaying(clock)
  const currentId = items[index]?.frameId ?? null
  const total = items.at(-1)?.end ?? 0
  const itemsRef = useRef(items)
  itemsRef.current = items

  const seek = useCallback(
    (frameId: string) => {
      const play = itemsRef.current.find((i) => i.frameId === frameId)
      if (play) clock.seek(play.start)
    },
    [clock],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">Shots</span>
        <span className="text-[12px] text-fg-3 tabular-nums">
          {items.length} · {formatSeconds(total)}
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {timelineItems.map((item) => {
          const frame = s.frames[item.frameId]
          if (!frame) return null
          const vo = frame.audio.find((l) => l.kind === 'vo')
          return (
            <ShotRow
              key={item.frameId}
              frame={frame}
              hero={heroOf(s, frame)}
              recorded={vo?.assetId ? s.assets[vo.assetId] : undefined}
              cutId={cutId}
              hidden={item.hidden}
              start={item.start}
              duration={item.duration}
              label={labels.get(item.frameId) ?? '—'}
              current={item.frameId === currentId}
              follow={playing && item.frameId === currentId}
              recorder={recorder}
              onSeek={seek}
              onRecord={onRecord}
              onStopRecording={onStopRecording}
            />
          )
        })}
      </ol>
    </div>
  )
}

const ShotRow = memo(function ShotRow({
  frame,
  hero,
  recorded,
  cutId,
  hidden,
  start,
  duration,
  label,
  current,
  follow,
  recorder,
  onSeek,
  onRecord,
  onStopRecording,
}: {
  frame: FrameSnapshot
  hero: AssetSnapshot | undefined
  recorded: AssetSnapshot | undefined
  cutId: string
  hidden: boolean
  start: number
  duration: number
  label: string
  current: boolean
  follow: boolean
  recorder: RecorderState
  onSeek: (frameId: string) => void
  onRecord: (frameId: string) => void
  onStopRecording: () => void
}) {
  const project = useProject()
  const ref = useRef<HTMLLIElement>(null)
  const vo = frame.audio.find((l) => l.kind === 'vo')
  const recordingThis = recorder.status === 'recording' && recorder.frameId === frame.id
  const savingThis = recorder.status === 'saving' && recorder.frameId === frame.id
  const busyElsewhere = recorder.status !== 'idle' && recorder.frameId !== frame.id

  useEffect(() => {
    if (follow) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [follow])

  return (
    <li
      ref={ref}
      onClick={() => onSeek(frame.id)}
      className={cx(
        'flex cursor-pointer gap-2.5 border-b border-line px-3 py-2.5 transition-colors',
        current ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]' : 'hover:bg-hover',
        hidden && 'opacity-55',
      )}
    >
      <div className="mt-0.5 h-[54px] w-[96px] shrink-0 overflow-hidden rounded-md border border-line bg-media">
        {hero?.hash && hero.kind === 'image' && <img src={mediaUrl(hero.hash)} alt="" className="size-full object-cover" draggable={false} />}
        {hero?.hash && hero.kind === 'video' && <video src={mediaUrl(hero.hash)} muted preload="metadata" className="size-full object-cover" />}
        {!hero?.hash && (
          <div className="flex size-full items-center justify-center text-fg-3">
            <Film size={16} aria-hidden />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-1.5">
          <span className="rounded bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-strong tabular-nums">{label}</span>
          <span className="text-[11px] text-fg-3 tabular-nums">
            {hidden ? 'Hidden' : `${formatSeconds(start)} · ${formatDuration(duration)}`}
          </span>
          <div className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>
            {recordingThis ? (
              <button
                type="button"
                onClick={onStopRecording}
                className="flex h-6 items-center gap-1 rounded-md bg-danger px-2 text-[11px] font-medium text-white"
              >
                <Square size={10} fill="currentColor" aria-hidden /> Stop
              </button>
            ) : savingThis ? (
              <Loader2 size={14} className="mx-1.5 animate-spin text-fg-3" aria-label="Saving recording" />
            ) : (
              <IconButton
                size="sm"
                label={recorded ? 'Record the VO again' : 'Record VO for this frame'}
                disabled={busyElsewhere || hidden}
                onClick={() => onRecord(frame.id)}
                className="size-6"
              >
                <Mic size={13} />
              </IconButton>
            )}
            <IconButton
              size="sm"
              label={hidden ? 'Show in this cut' : 'Hide in this cut'}
              onClick={() => project.setHidden(cutId, frame.id, !hidden)}
              className="size-6"
            >
              {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </IconButton>
          </div>
        </div>
        <BoundTextarea
          bindKey={`${frame.id}:description`}
          resolve={() => project.frameText(frame.id, 'description')}
          autoGrow
          rows={1}
          placeholder="What happens in this shot?"
          aria-label={`Description of ${label}`}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] leading-snug text-fg placeholder:text-fg-3 hover:border-line focus:border-accent focus:bg-bg focus:outline-none"
        />
        <div className="flex items-start gap-1">
          <span className="mt-[3px] shrink-0 pl-1 text-[9px] font-bold tracking-wider text-fg-3">VO</span>
          <BoundTextarea
            bindKey={`${frame.id}:vo:${vo?.id ?? 'none'}`}
            resolve={() => (vo ? project.audioText(frame.id, vo.id) : null)}
            create={(initial) => {
              project.setVo(frame.id, initial)
              return project.audioText(frame.id, project.voLineId(frame.id))
            }}
            autoGrow
            rows={1}
            placeholder="Voiceover"
            aria-label={`Voiceover for ${label}`}
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] leading-snug text-fg-2 italic placeholder:text-fg-3 placeholder:not-italic hover:border-line focus:border-accent focus:bg-bg focus:outline-none"
          />
        </div>
        {recorded && vo && (
          <div className="mt-1 flex items-center gap-1 pl-1 text-[11px] text-accent-strong" onClick={(e) => e.stopPropagation()}>
            <Mic size={11} aria-hidden />
            <span>Recorded · {formatDuration(recorded.duration ?? 0)}</span>
            <button
              type="button"
              onClick={() => project.setAudioAsset(frame.id, vo.id, null)}
              className="ml-1 rounded p-0.5 text-fg-3 hover:text-danger"
              aria-label="Remove the recording"
              title="Remove the recording"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>
    </li>
  )
})
