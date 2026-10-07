import {
  SKETCH_PAPER,
  aspectValue,
  exportProject,
  mediaFileName,
  notesToMarkdown,
  safeFileName,
  scriptsMarkdown,
  shotLabels,
  sketchFileName,
  sketchSvg,
  type AssetSnapshot,
  type NotesPage,
  type Project,
  type ProjectPlace,
  type ProjectSnapshot,
} from '@weft/model'
import * as Y from 'yjs'
import type { LibraryItem } from '../lib/api'
import { displayUrl, mediaUrl } from '../lib/media'
import { fileIn, fileNames, folderIn, removeFile, writeFile } from './fs'

/**
 * The files Weft keeps in a project's folder, and in a space's or folder's:
 * the project's exact sync state and readable copies of it, and a library's
 * notes and media.
 */

export const SYNC_FILE = 'project.sync'
export const JSON_FILE = 'project.json'
export const SCRIPT_FILE = 'script.md'
export const ABOUT_FILE = 'About.md'
export const LIBRARY_DIR = 'Library'
const LIBRARY_JSON = 'library.json'

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * A copy a cloud drive made when two computers saved at once: OneDrive's
 * "project-LAPTOP.sync", Google Drive's "project (1).sync", Dropbox's
 * "project (Priya's conflicted copy).sync".
 */
export function isConflictCopy(name: string, of: string): boolean {
  const dot = of.lastIndexOf('.')
  const base = of.slice(0, dot).toLowerCase()
  const ext = of.slice(dot).toLowerCase()
  const lower = name.toLowerCase()
  return lower !== of.toLowerCase() && lower.endsWith(ext) && (lower.startsWith(`${base} (`) || lower.startsWith(`${base}-`))
}

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

/** Writes a text file unless it already says exactly that, so synced folders don't churn. */
async function writeText(dir: FileSystemDirectoryHandle, name: string, content: string, known?: Map<string, string>, key = name): Promise<void> {
  if (known?.get(key) === content) return
  if (!known?.has(key)) {
    const existing = await fileIn(dir, name)
    if (existing && (await existing.text()) === content) {
      known?.set(key, content)
      return
    }
  }
  await writeFile(dir, name, content)
  known?.set(key, content)
}

/** Writes one project's folder. Keep one per folder: it remembers what's there, to write only what changed. */
export class ProjectFiles {
  private readonly texts = new Map<string, string>()
  private media: Set<string> | null = null
  private notes: Set<string> | null = null
  private sketches: Set<string> | null = null
  private lastVector: Uint8Array | null = null

  constructor(
    readonly dir: FileSystemDirectoryHandle,
    private readonly projectId: string,
  ) {}

  /**
   * Merges the folder's saved state into `doc`, with any conflict copies a
   * cloud drive made. Returns those copies, to clear away once saved.
   */
  async readInto(doc: Y.Doc, origin?: unknown): Promise<string[]> {
    const merged: string[] = []
    for (const name of await fileNames(this.dir)) {
      if (name !== SYNC_FILE && !isConflictCopy(name, SYNC_FILE)) continue
      const file = await fileIn(this.dir, name)
      if (!file) continue
      const bytes = new Uint8Array(await file.arrayBuffer())
      try {
        Y.applyUpdate(doc, bytes, origin)
      } catch {
        // Not a project's state after all: leave it be.
        continue
      }
      if (name !== SYNC_FILE) merged.push(name)
      // What's on disk already: if nothing's new, project.sync needn't be written again (no churn in a shared vault).
      else this.lastVector = Y.encodeStateVectorFromUpdate(bytes)
    }
    return merged
  }

  /** Clears away conflict copies once project.sync holds their changes, and stray copies of the readable files. */
  async tidy(conflicts: readonly string[]): Promise<void> {
    for (const name of conflicts) await removeFile(this.dir, name)
    for (const name of await fileNames(this.dir)) {
      if (isConflictCopy(name, JSON_FILE) || isConflictCopy(name, SCRIPT_FILE)) await removeFile(this.dir, name)
    }
  }

  async write(
    doc: Y.Doc,
    project: Project,
    place: ProjectPlace | null,
    progress?: (detail: string) => void,
    stopped: () => boolean = () => false,
  ): Promise<void> {
    const vector = Y.encodeStateVector(doc)
    if (!this.lastVector || !same(vector, this.lastVector)) {
      await writeFile(this.dir, SYNC_FILE, new Uint8Array(Y.encodeStateAsUpdate(doc)))
      this.lastVector = vector
    }
    const s = project.snapshot()
    const pages: NotesPage[] = Object.values(s.pages)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => ({ id: p.id, title: p.title || 'Untitled', markdown: notesToMarkdown(project.pageFragment(p.id)) }))
    await writeText(this.dir, JSON_FILE, `${JSON.stringify(exportProject(s, { projectId: this.projectId, notes: pages, place }), null, 2)}\n`, this.texts)
    await writeText(this.dir, SCRIPT_FILE, scriptsMarkdown(s), this.texts)
    await this.writeNotes(pages)
    await this.writeSketches(s)
    await this.writeMedia(s, progress, stopped)
  }

  /** Each sketched frame as an SVG in sketches/ (on paper if it has no picture). sketches/ is Weft's too. */
  private async writeSketches(s: ProjectSnapshot): Promise<void> {
    const labels = shotLabels(s)
    const aspect = aspectValue(s.meta.aspect)
    const wanted = new Map<string, string>()
    for (const f of Object.values(s.frames)) {
      if (!f.sketch.length) continue
      const name = sketchFileName(f.id, labels.get(f.id) ?? null).slice('sketches/'.length)
      wanted.set(name, `${sketchSvg(f.sketch, aspect, { width: 1920, background: f.heroMediaId ? null : SKETCH_PAPER })}
`)
    }
    const existing = await folderIn(this.dir, 'sketches', false)
    if (!wanted.size && !existing) return
    const folder = existing ?? (await folderIn(this.dir, 'sketches', true))!
    this.sketches ??= new Set((await fileNames(folder)).filter((n) => n.toLowerCase().endsWith('.svg')))
    for (const [name, svg] of wanted) await writeText(folder, name, svg, this.texts, `sketches/${name}`)
    for (const old of this.sketches) {
      if (wanted.has(old)) continue
      await removeFile(folder, old)
      this.texts.delete(`sketches/${old}`)
    }
    this.sketches = new Set(wanted.keys())
    if (!wanted.size) await this.dir.removeEntry('sketches').catch(() => undefined)
  }

  /** One Markdown file per notes page. notes/ is Weft's: pages renamed or deleted take their files with them. */
  private async writeNotes(pages: readonly NotesPage[]): Promise<void> {
    const folder = (await folderIn(this.dir, 'notes', true))!
    this.notes ??= new Set((await fileNames(folder)).filter((n) => n.toLowerCase().endsWith('.md')))
    const names = new Set<string>()
    for (const page of pages) {
      const base = safeFileName(page.title)
      let name = `${base}.md`
      for (let n = 2; names.has(name); n++) name = `${base} (${n}).md`
      names.add(name)
      await writeText(folder, name, page.markdown ? `${page.markdown}\n` : '', this.texts, `notes/${name}`)
    }
    for (const old of this.notes) {
      if (names.has(old)) continue
      await removeFile(folder, old)
      this.texts.delete(`notes/${old}`)
    }
    this.notes = names
  }

  private async writeMedia(s: ProjectSnapshot, progress?: (detail: string) => void, stopped: () => boolean = () => false): Promise<void> {
    const files = Object.values(s.assets).flatMap((a) => {
      const name = a.kind !== 'link' && a.hash ? mediaFileName(a) : null
      return name ? [{ hash: a.hash!, name }] : []
    })
    if (!files.length) return
    const folder = (await folderIn(this.dir, 'media', true))!
    this.media ??= new Set(await fileNames(folder))
    const missing = files.filter((f) => !this.media!.has(f.name))
    for (const [i, f] of missing.entries()) {
      if (stopped()) return
      progress?.(missing.length > 1 ? `Saving files (${i + 1} of ${missing.length})` : 'Saving a file')
      // From memory if it was just added here, otherwise the original from the server.
      const res = await fetch(displayUrl(f.hash), { credentials: 'same-origin' })
      // A file still on its way to the server is picked up by a later save.
      if (!res.ok || !res.body) continue
      await writeFile(folder, f.name, res.body)
      this.media.add(f.name)
    }
  }
}

/** A library item's file name: readable, plus the start of its hash so names never clash. */
export const libraryFileName = (item: LibraryItem) =>
  mediaFileName({ hash: item.hash, name: item.name, title: '', mime: item.mime, kind: item.kind } as AssetSnapshot)!

/**
 * A space's or folder's library: About.md with its notes, and Library/ with
 * its pictures, clips and sound, and library.json listing their tags and
 * captions. Library/ is Weft's: items taken out of the library leave it too.
 */
export async function writeLibrary(
  dir: FileSystemDirectoryHandle,
  level: { name: string; about: string; items: readonly LibraryItem[] },
  progress?: (detail: string) => void,
  stopped: () => boolean = () => false,
): Promise<void> {
  const about = level.about.trim()
  if (about) await writeText(dir, ABOUT_FILE, `# ${level.name}\n\n${about}\n`)
  else {
    const old = await fileIn(dir, ABOUT_FILE)
    if (old && (await old.text()).startsWith('# ')) await removeFile(dir, ABOUT_FILE)
  }

  const existing = await folderIn(dir, LIBRARY_DIR, false)
  if (!level.items.length && !existing) return
  const folder = existing ?? (await folderIn(dir, LIBRARY_DIR, true))!
  const wanted = level.items.map((item) => ({ item, file: libraryFileName(item) }))
  const present = new Set(await fileNames(folder))
  const missing = wanted.filter((w) => !present.has(w.file))
  for (const [i, w] of missing.entries()) {
    if (stopped()) return
    progress?.(`Saving ${level.name}'s library (${i + 1} of ${missing.length})`)
    const res = await fetch(mediaUrl(w.item.hash), { credentials: 'same-origin' })
    if (!res.ok || !res.body) continue
    await writeFile(folder, w.file, res.body)
  }
  const keep = new Set([LIBRARY_JSON, ...wanted.map((w) => w.file)])
  for (const name of present) if (!keep.has(name)) await removeFile(folder, name)
  if (!wanted.length) {
    await removeFile(folder, LIBRARY_JSON)
    await dir.removeEntry(LIBRARY_DIR).catch(() => undefined)
    return
  }
  const listing = {
    weft: 1,
    library: level.name,
    items: wanted.map(({ item, file }) => ({
      file,
      name: item.name,
      kind: item.kind,
      tags: item.tags,
      caption: item.caption,
      ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
      ...(item.duration ? { seconds: item.duration } : {}),
    })),
  }
  await writeText(folder, LIBRARY_JSON, `${JSON.stringify(listing, null, 2)}\n`)
}
