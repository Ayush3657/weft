import type * as Y from 'yjs'
import type { Project } from './project'
import { buildSnapshot, readAsset, readCut, readFrame, readLink, readMeta, readScene, type YMap } from './read'
import type { ProjectSnapshot } from './types'

type Listener = () => void

function patchRecord<T>(
  prev: Readonly<Record<string, T>>,
  ids: Set<string>,
  read: (id: string) => T | undefined,
): Record<string, T> {
  const next = { ...prev }
  for (const id of ids) {
    const value = read(id)
    if (value === undefined) delete next[id]
    else next[id] = value
  }
  ids.clear()
  return next
}

/**
 * Keeps an immutable snapshot of a project up to date. Frames, links and other
 * items that didn't change keep their object identity between snapshots, so
 * UIs can skip re-rendering them. Works with React's useSyncExternalStore.
 */
export class SnapshotStore {
  readonly project: Project
  private current: ProjectSnapshot
  private readonly listeners = new Set<Listener>()
  private readonly cleanups: Array<() => void> = []
  private scheduled = false
  private metaDirty = false
  private readonly dirty = {
    frames: new Set<string>(),
    links: new Set<string>(),
    cuts: new Set<string>(),
    scenes: new Set<string>(),
    assets: new Set<string>(),
  }

  constructor(project: Project) {
    this.project = project
    this.current = buildSnapshot(project)
    this.watch(project.frames, this.dirty.frames)
    this.watch(project.links, this.dirty.links)
    this.watch(project.cuts, this.dirty.cuts)
    this.watch(project.scenes, this.dirty.scenes)
    this.watch(project.assets, this.dirty.assets)
    const onMeta = () => {
      this.metaDirty = true
      this.schedule()
    }
    project.meta.observeDeep(onMeta)
    this.cleanups.push(() => project.meta.unobserveDeep(onMeta))
  }

  getSnapshot = (): ProjectSnapshot => this.current

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Applies pending changes immediately instead of on the next microtask. */
  flush = (): void => {
    this.scheduled = false
    const { project: p, dirty } = this
    const changed =
      this.metaDirty ||
      dirty.frames.size > 0 ||
      dirty.links.size > 0 ||
      dirty.cuts.size > 0 ||
      dirty.scenes.size > 0 ||
      dirty.assets.size > 0
    if (!changed) return
    const prev = this.current
    const read = <T>(map: Y.Map<YMap>, reader: (m: YMap) => T) => (id: string) => {
      const m = map.get(id)
      return m ? reader(m) : undefined
    }
    this.current = {
      meta: this.metaDirty ? readMeta(p.meta) : prev.meta,
      frames: dirty.frames.size ? patchRecord(prev.frames, dirty.frames, read(p.frames, readFrame)) : prev.frames,
      links: dirty.links.size ? patchRecord(prev.links, dirty.links, read(p.links, readLink)) : prev.links,
      cuts: dirty.cuts.size ? patchRecord(prev.cuts, dirty.cuts, read(p.cuts, readCut)) : prev.cuts,
      scenes: dirty.scenes.size ? patchRecord(prev.scenes, dirty.scenes, read(p.scenes, readScene)) : prev.scenes,
      assets: dirty.assets.size ? patchRecord(prev.assets, dirty.assets, read(p.assets, readAsset)) : prev.assets,
    }
    this.metaDirty = false
    for (const listener of [...this.listeners]) listener()
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups.length = 0
    this.listeners.clear()
  }

  private watch(map: Y.Map<YMap>, dirty: Set<string>): void {
    const handler = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
      for (const event of events) {
        if (event.target === map) {
          for (const key of (event as unknown as Y.YMapEvent<YMap>).keysChanged) dirty.add(key)
        } else {
          const first = event.path[0]
          if (typeof first === 'string') dirty.add(first)
        }
      }
      this.schedule()
    }
    map.observeDeep(handler)
    this.cleanups.push(() => map.unobserveDeep(handler))
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(this.flush)
  }
}
