import { exportProject, mediaFileName, notesToMarkdown, safeFileName, scriptsMarkdown, type NotesPage, type Project, type ProjectSnapshot } from '@weft/model'
import * as Y from 'yjs'
import { displayUrl } from '../lib/media'
import { fileIn, fileNames, folderIn, folderPermission, removeFile, writeFile } from './fs'

export const SYNC_FILE = 'project.sync'
export const JSON_FILE = 'project.json'
const SCRIPT_FILE = 'script.md'

export type MirrorState =
  | { kind: 'starting' }
  | { kind: 'needs-permission' }
  | { kind: 'saving'; detail: string | null }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'stopped' }

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

const isPermissionError = (error: unknown) => error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')

/** The project id saved in a folder's project.json, if it has one. */
export async function savedProjectId(dir: FileSystemDirectoryHandle): Promise<string | null> {
  const file = await fileIn(dir, JSON_FILE)
  if (!file) return null
  try {
    const id = (JSON.parse(await file.text()) as { projectId?: unknown }).projectId
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/**
 * Keeps a project's folder up to date while the project is open: the exact
 * sync state (project.sync), readable copies (project.json, script.md, one
 * Markdown file per notes page) and every picture, video and sound (media/).
 * On start it first merges in what the folder holds, so edits made elsewhere
 * (another computer, through a folder in OneDrive or Dropbox) come in.
 */
export class VaultMirror {
  private state: MirrorState = { kind: 'starting' }
  private readonly listeners = new Set<() => void>()
  private timer = 0
  private firstPending = 0
  private running: Promise<void> | null = null
  private queued = false
  private stopped = false
  private listening = false
  private lastVector: Uint8Array | null = null
  private readonly texts = new Map<string, string>()
  private readonly media = new Set<string>()
  private mediaListed = false
  private notes = new Set<string>()

  constructor(
    private readonly doc: Y.Doc,
    private readonly project: Project,
    private readonly projectId: string,
    readonly dir: FileSystemDirectoryHandle,
    /** The folder was opened on purpose, so it counts as this project even if it was saved under another id. */
    private readonly adopt: boolean,
  ) {}

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
    if ((await folderPermission(this.dir, false)) !== 'granted') {
      this.set({ kind: 'needs-permission' })
      return
    }
    try {
      const saved = await savedProjectId(this.dir)
      if (saved && saved !== this.projectId && !this.adopt) {
        this.set({ kind: 'error', message: `“${this.dir.name}” holds a different project, so Weft won't write over it.` })
        return
      }
      const synced = await fileIn(this.dir, SYNC_FILE)
      if (synced) Y.applyUpdate(this.doc, new Uint8Array(await synced.arrayBuffer()), this)
    } catch (error) {
      this.fail(error)
      return
    }
    if (!this.listening) {
      this.doc.on('update', this.onUpdate)
      this.listening = true
    }
    await this.save()
  }

  /** Asks the browser for the folder again. Must be called from a click. */
  async reconnect(): Promise<boolean> {
    if ((await folderPermission(this.dir, true)) !== 'granted') return false
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

  private async write(): Promise<void> {
    this.firstPending = 0
    window.clearTimeout(this.timer)
    try {
      this.set({ kind: 'saving', detail: null })
      const vector = Y.encodeStateVector(this.doc)
      if (!this.lastVector || !same(vector, this.lastVector)) {
        await writeFile(this.dir, SYNC_FILE, new Uint8Array(Y.encodeStateAsUpdate(this.doc)))
        this.lastVector = vector
      }
      const s = this.project.snapshot()
      const pages: NotesPage[] = Object.values(s.pages)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((p) => ({ id: p.id, title: p.title || 'Untitled', markdown: notesToMarkdown(this.project.pageFragment(p.id)) }))
      await this.text(this.dir, JSON_FILE, `${JSON.stringify(exportProject(s, { projectId: this.projectId, notes: pages }), null, 2)}\n`)
      await this.text(this.dir, SCRIPT_FILE, scriptsMarkdown(s))
      await this.writeNotes(pages)
      await this.writeMedia(s)
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

  /** Writes a text file only if it changed, so synced folders don't churn. */
  private async text(dir: FileSystemDirectoryHandle, name: string, content: string, key = name): Promise<void> {
    if (this.texts.get(key) === content) return
    await writeFile(dir, name, content)
    this.texts.set(key, content)
  }

  private async writeNotes(pages: readonly NotesPage[]): Promise<void> {
    const folder = (await folderIn(this.dir, 'notes', true))!
    const names = new Set<string>()
    for (const page of pages) {
      const base = safeFileName(page.title)
      let name = `${base}.md`
      for (let n = 2; names.has(name); n++) name = `${base} (${n}).md`
      names.add(name)
      await this.text(folder, name, page.markdown ? `${page.markdown}\n` : '', `notes/${name}`)
    }
    // Pages renamed or deleted while the project was open: take their old files away.
    for (const old of this.notes) {
      if (!names.has(old)) {
        await removeFile(folder, old)
        this.texts.delete(`notes/${old}`)
      }
    }
    this.notes = names
  }

  private async writeMedia(s: ProjectSnapshot): Promise<void> {
    const files = Object.values(s.assets).flatMap((a) => {
      const name = a.kind !== 'link' && a.hash ? mediaFileName(a) : null
      return name ? [{ hash: a.hash!, name }] : []
    })
    if (!files.length) return
    const folder = (await folderIn(this.dir, 'media', true))!
    if (!this.mediaListed) {
      for (const name of await fileNames(folder)) this.media.add(name)
      this.mediaListed = true
    }
    const missing = files.filter((f) => !this.media.has(f.name))
    for (const [i, f] of missing.entries()) {
      if (this.stopped) return
      this.set({ kind: 'saving', detail: missing.length > 1 ? `Saving files (${i + 1} of ${missing.length})` : 'Saving a file' })
      // From memory if it was just added here, otherwise the original from the server.
      const res = await fetch(displayUrl(f.hash), { credentials: 'same-origin' })
      // A file still on its way to the server is picked up by a later save.
      if (!res.ok || !res.body) continue
      await writeFile(folder, f.name, res.body)
      this.media.add(f.name)
    }
  }

  stop(): void {
    this.stopped = true
    window.clearTimeout(this.timer)
    if (this.listening) this.doc.off('update', this.onUpdate)
    this.listening = false
    this.set({ kind: 'stopped' })
  }
}
