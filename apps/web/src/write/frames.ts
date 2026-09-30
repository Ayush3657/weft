import { cutTimeline, type FrameInit, type FrameSnapshot, type Project } from '@weft/model'

/** A frame that hasn't been written or drawn yet. */
export function isBlankFrame(frame: FrameSnapshot | undefined): boolean {
  return (
    !!frame &&
    !frame.description.trim() &&
    !frame.onScreenText.trim() &&
    !frame.media.length &&
    !frame.audio.some((l) => l.text.trim() || l.assetId)
  )
}

export interface NewFrame {
  description: string
  vo?: string
  onScreenText?: string
  /** Seconds; sets the frame to a manual length. */
  duration?: number | null
}

/**
 * Adds frames after the last one in a cut, in one undo step. A project's
 * untouched first frame takes the first of them rather than staying empty.
 */
export function appendFrames(project: Project, cutId: string, frames: readonly NewFrame[]): string[] {
  const s = project.snapshot()
  const items = cutTimeline(s, cutId).items
  const only = items.length === 1 ? items[0] : undefined
  const reuse = only && isBlankFrame(s.frames[only.frameId]) ? only.frameId : null
  let previous = items.at(-1)?.frameId ?? null
  const ids: string[] = []
  project.transact(() => {
    frames.forEach((f, i) => {
      if (i === 0 && reuse) {
        project.setText(reuse, 'description', f.description)
        if (f.onScreenText) project.setText(reuse, 'onScreenText', f.onScreenText)
        if (f.vo) project.setVo(reuse, f.vo)
        if (f.duration) project.setDuration(reuse, f.duration)
        ids.push(reuse)
        return
      }
      const init: FrameInit = {
        description: f.description,
        onScreenText: f.onScreenText ?? '',
        audio: f.vo ? [{ kind: 'vo', text: f.vo }] : [],
        ...(f.duration ? { durationMode: 'manual' as const, duration: f.duration } : {}),
      }
      previous = previous ? project.insertFrameAfter(previous, { cutId, init }) : project.appendFrame(cutId, init)
      ids.push(previous)
    })
  })
  return ids
}
