import type * as Y from 'yjs'
import type { Project } from './project'
import {
  buildSnapshot,
  readAsset,
  readBibleEntry,
  readBrief,
  readChangeSet,
  readCut,
  readFrame,
  readLink,
  readMeta,
  readMoodItem,
  readPage,
  readScene,
  type YMap,
} from './read'
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

type Collection = 'frames' | 'links' | 'cuts' | 'scenes' | 'assets' | 'bible' | 'pages' | 'moodboard' | 'changes'

/**
 * Keeps an immutable snapshot of a project up to date. Frames, links and other
 * items that didn't change keep their object identity between snapshots, so
 * UIs can skip re-rendering them. Works with React's useSyncExternalStore.
 *
 * Notes page content isn't part of the snapshot: the editor binds to it
 * directly, so typing a note doesn't rebuild anything here.
 */
export class SnapshotStore {
  readonly project: Project
  private current: ProjectSnapshot
  private readonly listeners = new Set<Listener>()
  private readonly cleanups: Array<() => void> = []
  private scheduled = false
  private metaDirty = false
  private briefDirty = false
  private readonly dirty: Record<Collection, Set<string>> = {
    frames: new Set(),
    links: new Set(),
    cuts: new Set(),
    scenes: new Set(),
    assets: new Set(),
    bible: new Set(),
    pages: new Set(),
    moodboard: new Set(),
    changes: new Set(),
  }

  constructor(project: Project) {
    this.project = project
    this.current = buildSnapshot(project)
    for (const name of Object.keys(this.dirty) as Collection[]) this.watch(project[name], this.dirty[name])
    this.watchWhole(project.meta, () => (this.metaDirty = true))
    this.watchWhole(project.brief, () => (this.briefDirty = true))
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
    const changed = this.metaDirty || this.briefDirty || Object.values(dirty).some((ids) => ids.size > 0)
    if (!changed) return
    const prev = this.current
    const patch = <T>(name: Collection, reader: (m: YMap) => T, before: Readonly<Record<string, T>>) =>
      dirty[name].size
        ? patchRecord(before, dirty[name], (id) => {
            const m = p[name].get(id)
            return m ? reader(m) : undefined
          })
        : before
    this.current = {
      meta: this.metaDirty ? readMeta(p.meta) : prev.meta,
      brief: this.briefDirty ? readBrief(p.brief) : prev.brief,
      frames: patch('frames', readFrame, prev.frames),
      links: patch('links', readLink, prev.links),
      cuts: patch('cuts', readCut, prev.cuts),
      scenes: patch('scenes', readScene, prev.scenes),
      assets: patch('assets', readAsset, prev.assets),
      bible: patch('bible', readBibleEntry, prev.bible),
      pages: patch('pages', readPage, prev.pages),
      moodboard: patch('moodboard', readMoodItem, prev.moodboard),
      changes: patch('changes', readChangeSet, prev.changes),
    }
    this.metaDirty = false
    this.briefDirty = false
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

  private watchWhole(map: YMap, markDirty: () => void): void {
    const handler = () => {
      markDirty()
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
