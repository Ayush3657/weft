import { cutTimeline, musicClip, playItems, shotLabels, voClips } from '@weft/model'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '../lib/auth'
import { importFile } from '../lib/media'
import { usePref } from '../lib/prefs'
import { toast, toastError } from '../lib/toast'
import { useProject, useSnapshot } from '../project/hooks'
import { useAudioSync } from './audio'
import { PlaybackClock } from './clock'
import { useVoRecorder } from './recorder'
import { ShotList } from './ShotList'
import { Stage, type Overlays } from './Stage'
import { Timeline } from './Timeline'
import { Transport, nextShot, previousShot } from './Transport'

const DEFAULT_OVERLAYS: Overlays = { text: true, captions: false, safe: false, info: true, sketch: true }

function useOverlays(): [Overlays, (key: keyof Overlays, value: boolean) => void] {
  const [raw, setRaw] = usePref('play-overlays')
  const overlays = useMemo<Overlays>(() => {
    try {
      return { ...DEFAULT_OVERLAYS, ...(raw ? (JSON.parse(raw) as Partial<Overlays>) : {}) }
    } catch {
      return DEFAULT_OVERLAYS
    }
  }, [raw])
  const set = useCallback(
    (key: keyof Overlays, value: boolean) => setRaw(JSON.stringify({ ...overlays, [key]: value })),
    [overlays, setRaw],
  )
  return [overlays, set]
}

/** The animatic: shot list, preview and timeline for the selected cut. */
export function Play({ cutId }: { cutId: string }) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const timeline = cutTimeline(s, cutId)
  const items = useMemo(() => playItems(s, cutId), [s, cutId])
  const labels = shotLabels(s)
  const [clock] = useState(() => new PlaybackClock())
  const [overlays, setOverlay] = useOverlays()
  const [mutedPref, setMutedPref] = usePref('play-muted')
  const muted = mutedPref === '1'

  useEffect(() => clock.setDuration(items.at(-1)?.end ?? 0), [clock, items])
  useEffect(() => () => clock.destroy(), [clock])

  const clipsKey = JSON.stringify([voClips(s, items), musicClip(s, cutId)])
  const clips = useMemo(() => {
    const vo = voClips(s, items)
    const music = musicClip(s, cutId)
    return music ? [...vo, music] : vo
    // Rebuild only when the clips themselves change, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsKey])
  useAudioSync(clock, clips, s.assets, muted)

  const recorder = useVoRecorder(async (frameId, file, seconds) => {
    const assetId = await importFile(project, file, user.id, { duration: Math.round(seconds * 100) / 100 })
    if (!project.getFrame(frameId)) return
    project.transact(() => project.setAudioAsset(frameId, project.voLineId(frameId), assetId))
    toast('VO recorded. The frame now times itself to it.', 'ok')
  })

  const record = useCallback(
    async (frameId: string) => {
      const item = items.find((i) => i.frameId === frameId)
      if (!(await recorder.start(frameId))) return
      // Play the picture from this frame so the read can be timed against it.
      if (item) clock.seek(item.start)
      clock.play()
    },
    [items, recorder, clock],
  )
  const stopRecording = useCallback(() => {
    recorder.stop()
    clock.pause()
  }, [recorder, clock])

  const addBeat = useCallback(() => project.addBeat(cutId, clock.getTime()), [project, cutId, clock])

  const onTrim = useCallback(
    (frameId: string, seconds: number) => {
      // The main cut changes the frame itself; other cuts keep their own length.
      if (s.cuts[cutId]?.isMain) project.setDuration(frameId, seconds)
      else project.setOverride(cutId, frameId, seconds)
    },
    [s.cuts, cutId, project],
  )

  const addMusic = useCallback(
    async (file: File) => {
      try {
        const assetId = await importFile(project, file, user.id)
        project.setCutMusic(cutId, assetId)
      } catch (error) {
        toastError(error)
      }
    },
    [project, user.id, cutId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return
      const fps = s.meta.fps || 25
      switch (e.key) {
        case ' ':
          e.preventDefault()
          clock.toggle()
          break
        case 'k':
          clock.pause()
          break
        case 'l':
          clock.play()
          break
        case 'j':
        case 'ArrowUp':
          e.preventDefault()
          previousShot(clock, items)
          break
        case 'ArrowDown':
          e.preventDefault()
          nextShot(clock, items)
          break
        case 'ArrowLeft':
          e.preventDefault()
          clock.pause()
          clock.seek(clock.getTime() - (e.shiftKey ? 1 : 1 / fps))
          break
        case 'ArrowRight':
          e.preventDefault()
          clock.pause()
          clock.seek(clock.getTime() + (e.shiftKey ? 1 : 1 / fps))
          break
        case 'Home':
          clock.seek(0)
          break
        case 'End':
          clock.seek(clock.getDuration())
          break
        case 'b':
        case 'B':
          if (e.shiftKey) project.removeBeat(cutId, clock.getTime(), 0.25)
          else addBeat()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clock, items, s.meta.fps, project, cutId, addBeat])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="w-[340px] shrink-0 border-r border-line bg-panel">
          <ShotList
            s={s}
            cutId={cutId}
            timelineItems={timeline.items}
            items={items}
            clock={clock}
            labels={labels}
            recorder={recorder.state}
            onRecord={(frameId) => void record(frameId)}
            onStopRecording={stopRecording}
          />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-canvas">
          <div className="min-h-0 flex-1 p-5">
            <Stage s={s} items={items} clock={clock} labels={labels} overlays={overlays} />
          </div>
          <div className="border-t border-line bg-panel">
            <Transport
              clock={clock}
              items={items}
              overlays={overlays}
              onOverlay={setOverlay}
              muted={muted}
              onMuted={(value) => setMutedPref(value ? '1' : null)}
            />
          </div>
        </div>
      </div>
      <Timeline
        s={s}
        cutId={cutId}
        items={items}
        clock={clock}
        labels={labels}
        onTrim={onTrim}
        onAddMusic={(file) => void addMusic(file)}
        onAddBeat={addBeat}
      />
    </div>
  )
}
