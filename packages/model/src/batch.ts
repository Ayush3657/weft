import { cutTimeline } from './timing'
import type { FrameInit, FramePatch, Project } from './project'
import type { FrameSnapshot } from './types'

/** A frame that hasn't been written or drawn yet. */
export function isBlankFrame(frame: FrameSnapshot | null | undefined): boolean {
  return (
    !!frame &&
    !frame.description.trim() &&
    !frame.onScreenText.trim() &&
    !frame.media.length &&
    !frame.audio.some((l) => l.text.trim() || l.assetId)
  )
}

/** Writes the given fields into an existing frame (audio lines, when given, replace the old ones). */
export function fillFrame(project: Project, frameId: string, init: FrameInit): void {
  project.transact(() => {
    if (init.description !== undefined) project.setText(frameId, 'description', init.description)
    if (init.onScreenText !== undefined) project.setText(frameId, 'onScreenText', init.onScreenText)
    if (init.motionNotes !== undefined) project.setText(frameId, 'motionNotes', init.motionNotes)
    if (init.notes !== undefined) project.setText(frameId, 'notes', init.notes)
    if (init.audio !== undefined) {
      for (const line of project.getFrame(frameId)?.audio ?? []) project.removeAudioLine(frameId, line.id)
      for (const line of init.audio) project.addAudioLine(frameId, line)
    }
    const patch: FramePatch = {}
    if (init.shotSize !== undefined) patch.shotSize = init.shotSize
    if (init.angle !== undefined) patch.angle = init.angle
    if (init.movement !== undefined) patch.movement = init.movement
    if (init.lens !== undefined) patch.lens = init.lens
    if (init.status !== undefined) patch.status = init.status
    if (init.sceneId !== undefined) patch.sceneId = init.sceneId
    if (Object.keys(patch).length) project.updateFrame(frameId, patch)
    if (init.durationMode === 'manual' && init.duration !== undefined) project.setDuration(frameId, init.duration)
    else if (init.durationMode === 'auto') project.resetDuration(frameId)
    for (const assetId of init.references ?? []) project.addReference(frameId, assetId)
    if (init.tags !== undefined) project.setTags(frameId, init.tags)
  })
}

/**
 * Adds frames to a cut in one undo step: after `after` if given, otherwise
 * after the cut's last frame. A project's untouched first frame takes the
 * first of them rather than staying empty. Returns the frames in order.
 */
export function appendFrames(project: Project, cutId: string, frames: readonly FrameInit[], opts: { after?: string } = {}): string[] {
  const s = project.snapshot()
  const items = cutTimeline(s, cutId).items
  const only = items.length === 1 ? items[0] : undefined
  const reuse = !opts.after && only && isBlankFrame(s.frames[only.frameId]) ? only.frameId : null
  let previous = opts.after ?? items.at(-1)?.frameId ?? null
  const ids: string[] = []
  project.transact(() => {
    frames.forEach((init, i) => {
      if (i === 0 && reuse) {
        fillFrame(project, reuse, init)
        ids.push(reuse)
        return
      }
      previous = previous ? project.insertFrameAfter(previous, { cutId, init }) : project.appendFrame(cutId, init)
      ids.push(previous)
    })
  })
  return ids
}
