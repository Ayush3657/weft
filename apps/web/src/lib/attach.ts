import type { Project } from '@weft/model'

/**
 * Puts Library assets on a frame. For the frame's picture, images and videos
 * become versions (or the current one, if already there) and audio becomes the
 * VO recording; everything else, and anything dropped on references, becomes a reference.
 */
export function attachToFrame(project: Project, frameId: string, assetIds: readonly string[], target: 'media' | 'references'): void {
  const frame = project.getFrame(frameId)
  if (!frame) return
  project.transact(() => {
    for (const id of assetIds) {
      const kind = project.assets.get(id)?.get('kind')
      if (!kind) continue
      if (target === 'media' && (kind === 'image' || kind === 'video')) {
        const existing = frame.media.find((v) => v.assetId === id)
        if (existing) project.setHeroMedia(frameId, existing.id)
        else project.addMediaVersion(frameId, id)
      } else if (target === 'media' && kind === 'audio') {
        project.setAudioAsset(frameId, project.voLineId(frameId), id)
      } else {
        project.addReference(frameId, id)
      }
    }
  })
}

/** Images and videos among the given assets, in order. */
export function pictureAssets(project: Project, assetIds: readonly string[]): string[] {
  return assetIds.filter((id) => {
    const kind = project.assets.get(id)?.get('kind')
    return kind === 'image' || kind === 'video'
  })
}
