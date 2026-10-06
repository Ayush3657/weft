import { Project, safeFileName, type ProjectPlace } from '@weft/model'
import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { api, type LibraryLevel, type ProjectSummary, type SpaceContents, type SpaceSummary } from '../lib/api'
import { readPref } from '../lib/prefs'
import { entries, fileIn, folderPermission, moveFolder, vaultSupported, writeFile } from './fs'
import { JSON_FILE, LIBRARY_DIR, ProjectFiles, SYNC_FILE, savedProjectId, writeLibrary } from './files'
import { VAULT_KEY, getStored, projectKey, putStored, type ProjectFolderRecord } from './store'

/**
 * The vault keeper: keeps the vault laid out like Weft (a folder per space,
 * its folders inside, a folder per storyboard) and every storyboard and
 * library in it up to date, while Weft is open in this browser. Renaming or
 * moving something in Weft moves its folder in the vault. Nothing is ever
 * deleted from the vault: something taken out of Weft stays where it was.
 */

/** Marks a space's or folder's folder in the vault, so it's found again after a rename or move. */
const MARKER = '.weft.json'
const MOVING = '.weft-moving'
/** Names Weft uses inside spaces' and folders' folders. */
const RESERVED = new Set([MARKER, 'about.md', LIBRARY_DIR.toLowerCase()])
const WRITTEN_KEY = 'written'
/** Spaces this browser doesn't keep in its vault (a pref, so new spaces are kept by default). */
export const SKIP_PREF = 'vault-skip'

const EVERY = 10 * 60_000

export type KeeperStatus =
  | { kind: 'unsupported' }
  | { kind: 'off' }
  | { kind: 'needs-permission'; vault: string }
  | { kind: 'idle'; vault: string; at: number | null; kept: number; problems: string[]; orphans: Orphan[] }
  | { kind: 'saving'; vault: string; done: number; total: number; detail: string; orphans: Orphan[] }

/** A storyboard in the vault that isn't in any space you can see (deleted, or from another server). */
export interface Orphan {
  dir: FileSystemDirectoryHandle
  projectId: string
  title: string
  place: ProjectPlace | null
}

interface Found {
  id: string
  kind: 'space' | 'folder' | 'project'
  parent: FileSystemDirectoryHandle
  name: string
  dir: FileSystemDirectoryHandle
  /** Its path in the vault, lower case: "asbl ads/broadway". */
  key: string
}

interface Child {
  id: string
  kind: Found['kind']
  base: string
  createdAt: number
}

interface Plan {
  spaces: Array<{ space: SpaceSummary; contents: SpaceContents }>
  /** Projects to leave out: kept elsewhere, or not kept at all. */
  skip: ReadonlySet<string>
}

interface Arranged {
  dirs: Map<string, FileSystemDirectoryHandle>
  paths: Map<string, string[]>
  index: Map<string, Found>
}

const keyOf = (path: readonly string[]) => path.join('/').toLowerCase()
const parentKeyOf = (key: string) => (key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '')

export function skippedSpaces(): Set<string> {
  try {
    return new Set(JSON.parse(readPref(SKIP_PREF) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** One vault job at a time, across every Weft tab in this browser. */
export function withVaultLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  return locks ? (locks.request('weft-vault', run) as Promise<T>) : run()
}

async function readMarker(dir: FileSystemDirectoryHandle): Promise<{ kind: 'space' | 'folder'; id: string } | null> {
  const file = await fileIn(dir, MARKER)
  if (!file) return null
  try {
    const data = JSON.parse(await file.text()) as { kind?: unknown; id?: unknown }
    return (data.kind === 'space' || data.kind === 'folder') && typeof data.id === 'string' ? { kind: data.kind, id: data.id } : null
  } catch {
    return null
  }
}

async function ensureMarker(dir: FileSystemDirectoryHandle, marker: { kind: 'space' | 'folder'; id: string; name: string }): Promise<void> {
  const text = `${JSON.stringify({ weft: 1, ...marker }, null, 2)}\n`
  const existing = await fileIn(dir, MARKER)
  if (existing && (await existing.text()) === text) return
  await writeFile(dir, MARKER, text)
}

/** What Weft has put in the vault so far, wherever it is now: spaces and folders by their marker, storyboards by their project.json. */
async function scan(root: FileSystemDirectoryHandle): Promise<Map<string, Found>> {
  const found = new Map<string, Found>()
  const walk = async (dir: FileSystemDirectoryHandle, parent: FileSystemDirectoryHandle | null, path: string[]): Promise<void> => {
    if (path.length > 12) return
    const list = await entries(dir)
    const has = (name: string) => list.some(([n, e]) => e.kind === 'file' && n === name)
    if (parent && has(JSON_FILE)) {
      const id = await savedProjectId(dir)
      if (id && !found.has(id)) found.set(id, { id, kind: 'project', parent, name: path.at(-1)!, dir, key: keyOf(path) })
      return
    }
    if (parent && has(MARKER)) {
      const marker = await readMarker(dir)
      if (marker && !found.has(marker.id)) found.set(marker.id, { id: marker.id, kind: marker.kind, parent, name: path.at(-1)!, dir, key: keyOf(path) })
    }
    for (const [name, entry] of list) {
      if (entry.kind !== 'directory' || name === LIBRARY_DIR || name.endsWith(MOVING)) continue
      await walk(entry as FileSystemDirectoryHandle, dir, [...path, name])
    }
  }
  await walk(root, null, [])
  return found
}

/**
 * Names for the children of one folder: their own names, made unique (the
 * way Windows and macOS see it, ignoring case) and kept clear of anything
 * else already there.
 */
async function allocate(dir: FileSystemDirectoryHandle, key: string, children: readonly Child[], index: Map<string, Found>): Promise<Array<{ child: Child; name: string }>> {
  const owners = new Map<string, string | null>()
  for (const [name, entry] of await entries(dir)) {
    // An empty folder is anyone's to use (one made just before a pass started over, say).
    if (entry.kind === 'directory' && !(await entries(entry as FileSystemDirectoryHandle)).length) continue
    owners.set(name.toLowerCase(), null)
  }
  for (const f of index.values()) if (parentKeyOf(f.key) === key) owners.set(f.name.toLowerCase(), f.id)
  const taken = new Set<string>()
  return [...children]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((child) => {
      let name = child.base
      for (let n = 2; ; n++) {
        const lower = name.toLowerCase()
        const owner = owners.get(lower)
        if (!taken.has(lower) && !RESERVED.has(lower) && (owner === undefined || owner === child.id)) break
        name = `${child.base} (${n})`
      }
      taken.add(name.toLowerCase())
      return { child, name }
    })
}

/** Puts one thing where it belongs: it's there already, it's moved there (the vault is then rescanned), or it's made. */
async function settle(parent: FileSystemDirectoryHandle, parentKey: string, id: string, name: string, index: Map<string, Found>): Promise<FileSystemDirectoryHandle | 'moved'> {
  const found = index.get(id)
  const key = parentKey ? `${parentKey}/${name.toLowerCase()}` : name.toLowerCase()
  if (found && found.key === key && found.name === name) return found.dir
  if (found) {
    await moveFolder(found.parent, found.name, parent, name)
    return 'moved'
  }
  return parent.getDirectoryHandle(name, { create: true })
}

async function arrangeOnce(root: FileSystemDirectoryHandle, plan: Plan, index: Map<string, Found>): Promise<Omit<Arranged, 'index'> | 'moved'> {
  const dirs = new Map<string, FileSystemDirectoryHandle>()
  const paths = new Map<string, string[]>()
  const spaces = await allocate(
    root,
    '',
    plan.spaces.map(({ space }) => ({ id: space.id, kind: 'space', base: safeFileName(space.name, 'Space'), createdAt: 0 })),
    index,
  )
  for (const { child, name } of spaces) {
    const dir = await settle(root, '', child.id, name, index)
    if (dir === 'moved') return 'moved'
    await ensureMarker(dir, { kind: 'space', id: child.id, name: plan.spaces.find((s) => s.space.id === child.id)!.space.name })
    dirs.set(child.id, dir)
    paths.set(child.id, [name])
  }
  for (const { space, contents } of plan.spaces) {
    const level = async (parentId: string | null, dir: FileSystemDirectoryHandle, path: string[]): Promise<'moved' | null> => {
      const children: Child[] = [
        ...contents.folders
          .filter((f) => f.parentId === parentId)
          .map((f) => ({ id: f.id, kind: 'folder' as const, base: safeFileName(f.name, 'Folder'), createdAt: f.createdAt })),
        ...contents.projects
          .filter((p) => p.folderId === parentId && !plan.skip.has(p.id))
          .map((p) => ({ id: p.id, kind: 'project' as const, base: safeFileName(p.title), createdAt: p.createdAt })),
      ]
      for (const { child, name } of await allocate(dir, keyOf(path), children, index)) {
        const sub = await settle(dir, keyOf(path), child.id, name, index)
        if (sub === 'moved') return 'moved'
        dirs.set(child.id, sub)
        paths.set(child.id, [...path, name])
        if (child.kind === 'folder') {
          await ensureMarker(sub, { kind: 'folder', id: child.id, name: contents.folders.find((f) => f.id === child.id)!.name })
          if ((await level(child.id, sub, [...path, name])) === 'moved') return 'moved'
        }
      }
      return null
    }
    if ((await level(null, dirs.get(space.id)!, paths.get(space.id)!)) === 'moved') return 'moved'
  }
  return { dirs, paths }
}

/** Lays the vault out like Weft. Each move invalidates what's known about the vault, so it's scanned again after one. */
async function arrange(root: FileSystemDirectoryHandle, plan: Plan): Promise<Arranged> {
  for (let round = 0; round < 12; round++) {
    const index = await scan(root)
    const result = await arrangeOnce(root, plan, index)
    if (result !== 'moved') return { ...result, index }
  }
  throw new Error('The vault kept changing while Weft arranged it; it will try again later.')
}

function placeOf(project: ProjectSummary, contents: SpaceContents): ProjectPlace {
  const folders: string[] = []
  for (let id = project.folderId; id; ) {
    const folder = contents.folders.find((f) => f.id === id)
    if (!folder || folders.length > 50) break
    folders.unshift(folder.name)
    id = folder.parentId
  }
  return { space: contents.space.name, spaceId: contents.space.id, folders, folderId: project.folderId }
}

class VaultKeeper {
  private status: KeeperStatus = vaultSupported() ? { kind: 'off' } : { kind: 'unsupported' }
  private readonly listeners = new Set<() => void>()
  private started = false
  private timer = 0
  private running: Promise<void> | null = null
  private again = false
  private lastRun = 0
  /** Projects open in this tab, whose live copy keeps their folder up to date instead. */
  private readonly live = new Set<string>()

  getStatus = (): KeeperStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(status: KeeperStatus): void {
    this.status = status
    for (const listener of [...this.listeners]) listener()
  }

  /** Starts keeping the vault: soon after the app opens, every few minutes, and on coming back to the tab. */
  start(): void {
    if (this.started || !vaultSupported()) return
    this.started = true
    this.soon(3000)
    window.setInterval(() => this.soon(0), EVERY)
    window.addEventListener('focus', () => {
      if (Date.now() - this.lastRun > 2 * 60_000) this.soon(500)
    })
  }

  /** Runs a pass shortly (after a rename or move in Weft, say). */
  soon(ms = 2000): void {
    if (!vaultSupported()) return
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.run(), ms)
  }

  claim(projectId: string): void {
    this.live.add(projectId)
  }

  release(projectId: string): void {
    this.live.delete(projectId)
  }

  /** A full pass now. A pass asked for while one runs follows it. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.pass()
      .catch((error: unknown) => this.problem(error))
      .finally(() => {
        this.running = null
        this.lastRun = Date.now()
        if (this.again) {
          this.again = false
          this.soon(500)
        }
      })
    return this.running
  }

  private problem(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Something went wrong'
    const s = this.status
    this.set({
      kind: 'idle',
      vault: 'vault' in s ? s.vault : '',
      at: s.kind === 'idle' ? s.at : null,
      kept: s.kind === 'idle' ? s.kept : 0,
      problems: [message],
      orphans: 'orphans' in s ? s.orphans : [],
    })
  }

  private async vault(): Promise<FileSystemDirectoryHandle | null> {
    const vault = (await getStored<FileSystemDirectoryHandle>(VAULT_KEY)) ?? null
    if (!vault) {
      this.set({ kind: 'off' })
      return null
    }
    if ((await folderPermission(vault, false)) !== 'granted') {
      this.set({ kind: 'needs-permission', vault: vault.name })
      return null
    }
    return vault
  }

  /** What the vault should hold: the kept spaces, their folders, and their storyboards (minus those kept elsewhere or not at all). */
  private async plan(): Promise<Plan> {
    const { spaces } = await api<{ spaces: SpaceSummary[] }>('/api/spaces')
    const skipSpaces = skippedSpaces()
    const kept = spaces.filter((s) => !skipSpaces.has(s.id))
    const all = await Promise.all(kept.map(async (space) => ({ space, contents: await api<SpaceContents>(`/api/spaces/${space.id}/contents`) })))
    const skip = new Set<string>()
    for (const { contents } of all) {
      for (const p of contents.projects) {
        const rec = (await getStored<ProjectFolderRecord>(projectKey(p.id))) ?? {}
        if (rec.folder || rec.off) skip.add(p.id)
      }
    }
    return { spaces: all, skip }
  }

  /** The vault laid out, under the lock. */
  private arranged(vault: FileSystemDirectoryHandle, plan: Plan): Promise<Arranged> {
    return withVaultLock(() => arrange(vault, plan))
  }

  /**
   * Where an open storyboard's folder is (made or moved there first), for its
   * live copy. Null when the vault doesn't keep it.
   */
  async place(projectId: string): Promise<{ dir: FileSystemDirectoryHandle; path: string[]; place: ProjectPlace } | null> {
    const vault = await this.vault()
    if (!vault) return null
    const plan = await this.plan()
    const entry = plan.spaces.find(({ contents }) => contents.projects.some((p) => p.id === projectId))
    if (!entry || plan.skip.has(projectId)) return null
    const { dirs, paths } = await this.arranged(vault, plan)
    const dir = dirs.get(projectId)
    const project = entry.contents.projects.find((p) => p.id === projectId)!
    return dir ? { dir, path: paths.get(projectId)!, place: placeOf(project, entry.contents) } : null
  }

  private async pass(): Promise<void> {
    const vault = await this.vault()
    if (!vault) return
    const name = vault.name
    let orphans = 'orphans' in this.status ? this.status.orphans : []
    this.set({ kind: 'saving', vault: name, done: 0, total: 0, detail: 'Looking at the vault…', orphans })

    let plan: Plan
    try {
      plan = await this.plan()
    } catch {
      // Signed out, or the server's away: try again later, without fuss.
      this.set({ kind: 'idle', vault: name, at: null, kept: 0, problems: [], orphans })
      return
    }
    const { dirs, index } = await this.arranged(vault, plan)

    // Storyboards in the vault that aren't in any space you see.
    const visible = new Set((await api<{ projects: ProjectSummary[] }>('/api/projects')).projects.map((p) => p.id))
    orphans = []
    for (const f of index.values()) {
      if (f.kind !== 'project' || visible.has(f.id)) continue
      try {
        const file = await fileIn(f.dir, JSON_FILE)
        const data = (file ? JSON.parse(await file.text()) : {}) as { title?: string; place?: ProjectPlace }
        orphans.push({ dir: f.dir, projectId: f.id, title: data.title || f.name, place: data.place ?? null })
      } catch {
        orphans.push({ dir: f.dir, projectId: f.id, title: f.name, place: null })
      }
    }
    orphans.sort((a, b) => a.title.localeCompare(b.title))

    // What needs writing: libraries with anything in them, and storyboards changed since they were last written here.
    const written = (await getStored<Record<string, string>>(WRITTEN_KEY)) ?? {}
    const libraries: Array<{ dir: FileSystemDirectoryHandle; spaceId: string; folderId: string | null; name: string; about: string; count: number }> = []
    const projects: Array<{ dir: FileSystemDirectoryHandle; project: ProjectSummary; place: ProjectPlace; stamp: string }> = []
    let kept = 0
    for (const { space, contents } of plan.spaces) {
      const spaceDir = dirs.get(space.id)
      if (spaceDir) libraries.push({ dir: spaceDir, spaceId: space.id, folderId: null, name: space.name, about: contents.space.about, count: contents.libraryCounts[''] ?? 0 })
      for (const folder of contents.folders) {
        const dir = dirs.get(folder.id)
        if (dir) libraries.push({ dir, spaceId: space.id, folderId: folder.id, name: folder.name, about: folder.about, count: contents.libraryCounts[folder.id] ?? 0 })
      }
      for (const project of contents.projects) {
        const dir = dirs.get(project.id)
        if (!dir) continue
        kept++
        if (this.live.has(project.id)) continue
        const place = placeOf(project, contents)
        const stamp = `${project.updatedAt}|${place.spaceId}|${place.folderId ?? ''}|${place.folders.join('/')}|${place.space}`
        if (written[project.id] === stamp && (await fileIn(dir, SYNC_FILE))) continue
        projects.push({ dir, project, place, stamp })
      }
    }

    const problems: string[] = []
    const total = libraries.length + projects.length
    let done = 0
    const step = (detail: string) => this.set({ kind: 'saving', vault: name, done, total, detail, orphans })

    for (const lib of libraries) {
      step(`Saving the library of ${lib.name}`)
      try {
        const items = lib.count ? (await api<LibraryLevel>(lib.folderId ? `/api/library?folder=${lib.folderId}` : `/api/library?space=${lib.spaceId}`)).items : []
        await withVaultLock(() => writeLibrary(lib.dir, { name: lib.name, about: lib.about, items }, step))
      } catch (error) {
        problems.push(`${lib.name}'s library: ${error instanceof Error ? error.message : 'not saved'}`)
      }
      done++
    }

    for (const { dir, project, place, stamp } of projects) {
      step(`Saving “${project.title}”`)
      try {
        await withVaultLock(() => this.writeProject(dir, project, place, step))
        written[project.id] = stamp
        await putStored(WRITTEN_KEY, written)
      } catch (error) {
        problems.push(`“${project.title}”: ${error instanceof Error ? error.message : 'not saved'}`)
      }
      done++
    }

    this.set({ kind: 'idle', vault: name, at: Date.now(), kept, problems, orphans })
  }

  /** Writes one storyboard that isn't open here, from the server, keeping anything only its folder has. */
  private async writeProject(dir: FileSystemDirectoryHandle, project: ProjectSummary, place: ProjectPlace, step: (detail: string) => void): Promise<void> {
    const saved = await savedProjectId(dir)
    if (saved && saved !== project.id) throw new Error(`its folder “${dir.name}” holds a different storyboard`)
    const res = await fetch(`/api/projects/${project.id}/state`, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`the server didn't send it (${res.status})`)
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, new Uint8Array(await res.arrayBuffer()))
      const files = new ProjectFiles(dir, project.id)
      const conflicts = await files.readInto(doc)
      await files.write(doc, new Project(doc), place, (detail) => step(`“${project.title}”: ${detail.toLowerCase()}`))
      await files.tidy(conflicts)
    } finally {
      doc.destroy()
    }
  }
}

export const keeper = new VaultKeeper()

export function useKeeperStatus(): KeeperStatus {
  return useSyncExternalStore(keeper.subscribe, keeper.getStatus)
}
