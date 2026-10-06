import type { Project, ProjectPlace } from '@weft/model'
import type * as Y from 'yjs'
import { ProjectFiles, savedProjectId } from './files'
import { folderPermission } from './fs'
import { keeper, withVaultLock } from './keeper'

export { JSON_FILE, SYNC_FILE, savedProjectId } from './files'

export type MirrorState =
  | { kind: 'starting' }
  | { kind: 'needs-permission' }
  | { kind: 'saving'; detail: string | null }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'stopped' }

const isPermissionError = (error: unknown) => error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
const isMissing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError'

/** Finds the project's folder again after it moved, with where the project now is. */
export type Relocate = () => Promise<{ dir: FileSystemDirectoryHandle; place: ProjectPlace } | null>

/**
 * Keeps a project's folder up to date while the project is open: the exact
 * sync state (project.sync), readable copies (project.json, script.md, one
 * Markdown file per notes page) and every picture, video and sound (media/).
 * On start it first merges in what the folder holds, so edits made elsewhere
 * (another computer, through a vault in OneDrive or Google Drive) come in,
 * along with any conflict copies a cloud drive made.
 */
export class VaultMirror {
  private state: MirrorState = { kind: 'starting' }
  private readonly listeners = new Set<() => void>()
  private files: ProjectFiles
  private conflicts: string[] = []
  private timer = 0
  private firstPending = 0
  private running: Promise<void> | null = null
  private queued = false
  private stopped = false
  private listening = false

  constructor(
    private readonly doc: Y.Doc,
    private readonly project: Project,
    private readonly projectId: string,
    dir: FileSystemDirectoryHandle,
    /** The folder was opened on purpose, so it counts as this project even if it was saved under another id. */
    private readonly adopt: boolean,
    /** Where the project is in Weft, for project.json. */
    private place: ProjectPlace | null,
    /** For a project kept in the vault, whose folder follows it around. */
    private readonly relocate: Relocate | null,
  ) {
    this.files = new ProjectFiles(dir, projectId)
  }

  get dir(): FileSystemDirectoryHandle {
    return this.files.dir
  }

  getState = (): MirrorState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(state: MirrorState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }

  /** Starts mirroring if the browser still lets Weft use the folder; otherwise waits for `reconnect`. */
  async start(): Promise<void> {
    if (this.stopped) return
    if ((await folderPermission(this.files.dir, false)) !== 'granted') {
      this.set({ kind: 'needs-permission' })
      return
    }
    try {
      const saved = await savedProjectId(this.files.dir)
      if (saved && saved !== this.projectId && !this.adopt) {
        this.set({ kind: 'error', message: `“${this.files.dir.name}” holds a different project, so Weft won't write over it.` })
        return
      }
      this.conflicts = await withVaultLock(() => this.files.readInto(this.doc, this))
    } catch (error) {
      this.fail(error)
      return
    }
    // While it's open here, this copy keeps its folder; the vault keeper leaves it alone.
    if (this.relocate) keeper.claim(this.projectId)
    if (!this.listening) {
      this.doc.on('update', this.onUpdate)
      this.listening = true
    }
    await this.save()
  }

  /** Asks the browser for the folder again. Must be called from a click. */
  async reconnect(): Promise<boolean> {
    if ((await folderPermission(this.files.dir, true)) !== 'granted') return false
    await this.start()
    return true
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === this) return
    // Write a moment after edits pause, and at least every ten seconds while they don't.
    const now = Date.now()
    if (!this.firstPending) this.firstPending = now
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.save(), Math.max(0, Math.min(1500, this.firstPending + 10_000 - now)))
  }

  /** Writes everything that changed. Calls while a save is running queue one more. */
  save(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) {
      this.queued = true
      return this.running
    }
    this.running = this.write().finally(() => {
      this.running = null
      if (this.queued) {
        this.queued = false
        void this.save()
      }
    })
    return this.running
  }

  private writeOnce(): Promise<void> {
    return withVaultLock(async () => {
      await this.files.write(this.doc, this.project, this.place, (detail) => this.set({ kind: 'saving', detail }), () => this.stopped)
      if (this.conflicts.length) {
        await this.files.tidy(this.conflicts)
        this.conflicts = []
      }
    })
  }

  private async write(): Promise<void> {
    this.firstPending = 0
    window.clearTimeout(this.timer)
    try {
      this.set({ kind: 'saving', detail: null })
      try {
        await this.writeOnce()
      } catch (error) {
        if (!isMissing(error) || !this.relocate) throw error
        // Its folder moved (renamed or moved in Weft, maybe in another tab): find it and save there.
        const found = await this.relocate()
        if (!found) throw new Error("This project isn't kept in the vault any more")
        this.files = new ProjectFiles(found.dir, this.projectId)
        this.place = found.place
        await this.writeOnce()
      }
      if (!this.stopped) this.set({ kind: 'saved', at: Date.now() })
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown): void {
    if (this.stopped) return
    if (isPermissionError(error)) this.set({ kind: 'needs-permission' })
    else this.set({ kind: 'error', message: error instanceof Error ? error.message : "Couldn't save to the folder" })
  }

  stop(): void {
    this.stopped = true
    window.clearTimeout(this.timer)
    if (this.listening) this.doc.off('update', this.onUpdate)
    this.listening = false
    keeper.release(this.projectId)
    this.set({ kind: 'stopped' })
  }
}
