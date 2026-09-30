import type * as Y from 'yjs'
import { DEFAULT_WORDS_PER_SECOND } from './read'
import { Project } from './project'
import type { AspectRatio, ProjectType } from './types'

export const SCHEMA_VERSION = 1

export const PROJECT_DEFAULTS: Readonly<
  Record<ProjectType, { aspect: AspectRatio; fps: number; targetDuration: number | null }>
> = {
  ad: { aspect: '16:9', fps: 25, targetDuration: 30 },
  film: { aspect: '16:9', fps: 24, targetDuration: null },
  other: { aspect: '16:9', fps: 25, targetDuration: null },
}

export interface ProjectInit {
  title: string
  type?: ProjectType
  aspect?: AspectRatio
  fps?: number
  targetDuration?: number | null
  wordsPerSecond?: number
}

/**
 * Sets up a brand-new project document. Run exactly once per project (the
 * server does it at creation), never on clients, so replicas don't each
 * create their own main cut.
 */
export function initProject(doc: Y.Doc, init: ProjectInit): { mainCutId: string; firstFrameId: string } {
  const project = new Project(doc, { source: 'init' })
  const type = init.type ?? 'ad'
  const defaults = PROJECT_DEFAULTS[type]
  return project.transact(() => {
    project.meta.set('schemaVersion', SCHEMA_VERSION)
    const targetDuration = init.targetDuration === undefined ? defaults.targetDuration : init.targetDuration
    project.updateMeta({
      title: init.title,
      type,
      aspect: init.aspect ?? defaults.aspect,
      fps: init.fps ?? defaults.fps,
      targetDuration,
      wordsPerSecond: init.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND,
      autoLayout: true,
    })
    const mainCutId = project.createCut('Main cut', { main: true })
    project.setCutTarget(mainCutId, targetDuration)
    project.meta.set('mainCutId', mainCutId)
    const firstFrameId = project.createFrame()
    project.createPage('Notes', 'notes')
    return { mainCutId, firstFrameId }
  })
}
