import { Project, mediaFileName, safeFileName, type ProjectPlace } from '@weft/model'
import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { api, type ProjectSummary, type SpaceContents, type SpaceSummary } from '../lib/api'
import { uploadMedia } from '../lib/media'
import { JSON_FILE, SYNC_FILE, savedProjectId } from './files'
import { fileIn, fileNames, folderIn, folderPermission, pickFolder } from './fs'
import { keeper } from './keeper'
import type { Relocate } from './mirror'
import { VAULT_KEY, deleteStored, getStored, projectKey, putStored, type ProjectFolderRecord } from './store'

/**
 * The vault: a folder on this computer where Weft keeps a copy of every
 * storyboard, laid out like Weft (a folder per space, its folders inside, a
 * folder per storyboard) with each space's and folder's library. A project
 * can also live in a folder of its own, chosen for it or opened from anywhere.
 */

// ------------------------------------------------------------ change events

let version = 0
const listeners = new Set<() => void>()
function changed(): void {
  version++
  for (const listener of [...listeners]) listener()
}

/** Changes whenever the vault or a project's folder is chosen, changed or turned off. */
export function useVaultVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => version,
  )
}

// ------------------------------------------------------------------- vault

export const getVault = () => getStored<FileSystemDirectoryHandle>(VAULT_KEY).then((v) => v ?? null)

export async function setVault(dir: FileSystemDirectoryHandle | null): Promise<void> {
  if (dir) await putStored(VAULT_KEY, dir)
  else await deleteStored(VAULT_KEY)
  changed()
  keeper.soon(300)
}

export async function chooseVault(): Promise<FileSystemDirectoryHandle> {
  const dir = await pickFolder('weft-vault')
  await setVault(dir)
  return dir
}

/** Lets Weft write to the vault again (browsers ask once per visit). Must be called from a click. */
export async function allowVault(): Promise<boolean> {
  const vault = await getVault()
  if (!vault || (await folderPermission(vault, true)) !== 'granted') return false
  changed()
  keeper.soon(0)
  return true
}

const record = async (projectId: string) => (await getStored<ProjectFolderRecord>(projectKey(projectId))) ?? {}

async function updateRecord(projectId: string, patch: Partial<ProjectFolderRecord>): Promise<void> {
  await putStored(projectKey(projectId), { ...(await record(projectId)), ...patch })
  changed()
  keeper.soon()
}

/** A name for a project's folder inside a folder: its title, or "Title (2)" when another project has that one. */
async function freeName(parent: FileSystemDirectoryHandle, title: string, projectId: string): Promise<string> {
  const base = safeFileName(title)
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} (${n})`
    const existing = await folderIn(parent, name, false)
    if (!existing) return name
    const owner = await savedProjectId(existing)
    if (owner === projectId || (owner === null && !(await fileIn(existing, SYNC_FILE)))) return name
  }
}

export type ProjectFolder =
  /** `notKept`: there's a vault, but it doesn't keep this project's space. */
  | { kind: 'none'; hasVault: boolean; off: boolean; notKept?: boolean }
  | { kind: 'needs-permission'; vault: FileSystemDirectoryHandle; label: string }
  | {
      kind: 'folder'
      dir: FileSystemDirectoryHandle
      label: string
      adopt: boolean
      inVault: boolean
      place: ProjectPlace | null
      relocate: Relocate | null
    }

/** Where this project is kept on this computer, if anywhere. Its vault folder is made or moved into place first. */
export async function projectFolder(projectId: string): Promise<ProjectFolder> {
  const rec = await record(projectId)
  if (rec.folder) return { kind: 'folder', dir: rec.folder, label: rec.folder.name, adopt: !!rec.adopt, inVault: false, place: null, relocate: null }
  const vault = await getVault()
  if (!vault || rec.off) return { kind: 'none', hasVault: !!vault, off: !!rec.off }
  if ((await folderPermission(vault, false)) !== 'granted') return { kind: 'needs-permission', vault, label: vault.name }
  const placed = await keeper.place(projectId)
  if (!placed) return { kind: 'none', hasVault: true, off: false, notKept: true }
  const relocate: Relocate = async () => {
    const again = await keeper.place(projectId)
    return again && { dir: again.dir, place: again.place }
  }
  return { kind: 'folder', dir: placed.dir, label: [vault.name, ...placed.path].join(' › '), adopt: false, inVault: true, place: placed.place, relocate }
}

/**
 * Picks a folder of its own for a project. Picking the project's own folder
 * uses it as it is; any other folder gets a new folder for the project inside.
 */
export async function chooseProjectFolder(projectId: string, title: string): Promise<void> {
  const picked = await pickFolder('weft-project')
  const owner = await savedProjectId(picked)
  let dir = picked
  if (owner !== projectId) {
    if (owner) throw new Error(`“${picked.name}” already holds another Weft project. Pick an empty folder, or the folder that holds this one.`)
    dir = (await folderIn(picked, await freeName(picked, title, projectId), true))!
  }
  await updateRecord(projectId, { folder: dir, off: false, adopt: false })
}

/** Stops keeping a copy of this project on this computer (the folder and its files stay). */
export const stopSaving = (projectId: string) => updateRecord(projectId, { folder: undefined, off: true, adopt: false })

export const resumeVault = (projectId: string) => updateRecord(projectId, { folder: undefined, off: false })

// ----------------------------------------------------------- opening folders

export interface ImportPlace {
  spaceId: string
  folderId: string | null
}

async function readFolder(dir: FileSystemDirectoryHandle): Promise<{ projectId: string | null; title: string; place: ProjectPlace | null } | null> {
  if (!(await fileIn(dir, SYNC_FILE))) return null
  const json = await fileIn(dir, JSON_FILE)
  let projectId: string | null = null
  let title = dir.name
  let place: ProjectPlace | null = null
  if (json) {
    try {
      const data = JSON.parse(await json.text()) as { projectId?: unknown; title?: unknown; place?: ProjectPlace }
      if (typeof data.projectId === 'string') projectId = data.projectId
      if (typeof data.title === 'string' && data.title) title = data.title
      if (data.place && typeof data.place.spaceId === 'string') place = data.place
    } catch {
      // A damaged project.json doesn't stop the project opening; project.sync has everything.
    }
  }
  return { projectId, title, place }
}

/** Back where it was, if that space (and folder) is still there for you; otherwise `fallback`. */
async function homeFor(place: ProjectPlace | null, fallback?: ImportPlace): Promise<ImportPlace | undefined> {
  if (!place) return fallback
  const { spaces } = await api<{ spaces: SpaceSummary[] }>('/api/spaces').catch(() => ({ spaces: [] as SpaceSummary[] }))
  if (!spaces.some((s) => s.id === place.spaceId)) return fallback
  if (!place.folderId) return { spaceId: place.spaceId, folderId: null }
  const contents = await api<SpaceContents>(`/api/spaces/${place.spaceId}/contents`).catch(() => null)
  return { spaceId: place.spaceId, folderId: contents?.folders.some((f) => f.id === place.folderId) ? place.folderId : null }
}

/**
 * Opens a project folder in Weft: adds the project to this server (keeping its
 * id) where it was before, if that's still there, or else in `place`; or finds
 * it if the server already has it. Then uploads any pictures and clips the
 * server is missing. A folder outside the vault stays linked, so Weft keeps it
 * up to date. Returns the project id.
 */
export async function openFolder(dir: FileSystemDirectoryHandle, place?: ImportPlace): Promise<{ id: string; existed: boolean; restored: boolean; title: string }> {
  const found = await readFolder(dir)
  if (!found) throw new Error(`“${dir.name}” isn't a Weft project folder: there's no ${SYNC_FILE} in it. Pick the project's own folder.`)
  const state = new Uint8Array(await (await fileIn(dir, SYNC_FILE))!.arrayBuffer())
  const target = await homeFor(found.place, place)
  const query = new URLSearchParams()
  if (found.projectId) query.set('id', found.projectId)
  if (target) query.set('space', target.spaceId)
  if (target?.folderId) query.set('folder', target.folderId)
  const res = await fetch(`/api/projects/import${query.size ? `?${query}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: state,
    credentials: 'same-origin',
  })
  const body = (await res.json().catch(() => ({}))) as { project?: ProjectSummary; existed?: boolean; restored?: boolean; error?: string }
  if (!res.ok || !body.project) throw new Error(body.error ?? `Couldn't open the project (${res.status})`)

  // Pictures, video and sound the server doesn't have yet come from the folder's media/.
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  const assets = Object.values(new Project(doc).snapshot().assets).filter((a) => a.hash && a.kind !== 'link')
  doc.destroy()
  const media = await folderIn(dir, 'media', false)
  if (media && assets.length) {
    const names = new Set(await fileNames(media))
    for (const asset of assets) {
      const name = mediaFileName(asset)
      if (!name || !names.has(name)) continue
      const exists = await fetch(`/api/media/${asset.hash}/exists`, { credentials: 'same-origin' })
        .then((r) => r.json() as Promise<{ exists: boolean }>)
        .catch(() => ({ exists: false }))
      if (exists.exists) continue
      const file = (await fileIn(media, name))!
      await uploadMedia(new File([file], file.name, { type: asset.mime || file.type }))
    }
  }

  // A folder from inside the vault is the vault's to keep; one from anywhere else stays linked to the project.
  const vault = await getVault()
  const inVault = vault ? await isInside(vault, dir) : false
  if (!inVault) await updateRecord(body.project.id, { folder: dir, off: false, adopt: true })
  else keeper.soon()
  return { id: body.project.id, existed: !!body.existed, restored: !!body.restored, title: body.project.title }
}

/** Whether `dir` is somewhere inside `root`. */
async function isInside(root: FileSystemDirectoryHandle, dir: FileSystemDirectoryHandle): Promise<boolean> {
  const resolve = (root as FileSystemDirectoryHandle & { resolve?: (h: FileSystemHandle) => Promise<string[] | null> }).resolve
  if (typeof resolve !== 'function') return false
  return !!(await resolve.call(root, dir))
}

/** Asks for a folder, then opens it as above. */
export async function pickAndOpenFolder(place?: ImportPlace): Promise<{ id: string; existed: boolean; restored: boolean; title: string }> {
  return openFolder(await pickFolder('weft-open'), place)
}
