import { Project, mediaFileName, safeFileName } from '@weft/model'
import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { ProjectSummary } from '../lib/api'
import { uploadMedia } from '../lib/media'
import { fileIn, fileNames, folderIn, folderPermission, pickFolder, subfolders } from './fs'
import { JSON_FILE, SYNC_FILE, savedProjectId } from './mirror'
import { VAULT_KEY, deleteStored, getStored, projectKey, putStored, type ProjectFolderRecord } from './store'

/**
 * The vault: a folder on this computer where Weft keeps a copy of every
 * project you open, one folder per project. A project can also live in a
 * folder of its own, chosen for it or opened from anywhere.
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
}

export async function chooseVault(): Promise<FileSystemDirectoryHandle> {
  const dir = await pickFolder('weft-vault')
  await setVault(dir)
  return dir
}

const record = async (projectId: string) => (await getStored<ProjectFolderRecord>(projectKey(projectId))) ?? {}

async function updateRecord(projectId: string, patch: Partial<ProjectFolderRecord>): Promise<void> {
  await putStored(projectKey(projectId), { ...(await record(projectId)), ...patch })
  changed()
}

/** A name for the project's folder in the vault: its title, or "Title (2)" when another project has that one. */
async function freeName(vault: FileSystemDirectoryHandle, title: string, projectId: string): Promise<string> {
  const base = safeFileName(title)
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} (${n})`
    const existing = await folderIn(vault, name, false)
    if (!existing) return name
    const owner = await savedProjectId(existing)
    if (owner === projectId || (owner === null && !(await fileIn(existing, SYNC_FILE)))) return name
  }
}

export type ProjectFolder =
  | { kind: 'none'; hasVault: boolean; off: boolean }
  | { kind: 'needs-permission'; vault: FileSystemDirectoryHandle; label: string }
  | { kind: 'folder'; dir: FileSystemDirectoryHandle; label: string; adopt: boolean; inVault: boolean }

/** Where this project is kept on this computer, if anywhere. */
export async function projectFolder(projectId: string, title: string): Promise<ProjectFolder> {
  const rec = await record(projectId)
  if (rec.folder) return { kind: 'folder', dir: rec.folder, label: rec.folder.name, adopt: !!rec.adopt, inVault: false }
  const vault = await getVault()
  if (!vault || rec.off) return { kind: 'none', hasVault: !!vault, off: !!rec.off }
  if ((await folderPermission(vault, false)) !== 'granted') return { kind: 'needs-permission', vault, label: vault.name }
  const name = rec.name ?? (await freeName(vault, title, projectId))
  if (!rec.name) await putStored(projectKey(projectId), { ...rec, name })
  const dir = (await folderIn(vault, name, true))!
  return { kind: 'folder', dir, label: `${vault.name} / ${name}`, adopt: false, inVault: true }
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

export interface FolderProject {
  dir: FileSystemDirectoryHandle
  projectId: string | null
  title: string
}

async function readFolder(dir: FileSystemDirectoryHandle): Promise<FolderProject | null> {
  if (!(await fileIn(dir, SYNC_FILE))) return null
  const json = await fileIn(dir, JSON_FILE)
  let projectId: string | null = null
  let title = dir.name
  if (json) {
    try {
      const data = JSON.parse(await json.text()) as { projectId?: unknown; title?: unknown }
      if (typeof data.projectId === 'string') projectId = data.projectId
      if (typeof data.title === 'string' && data.title) title = data.title
    } catch {
      // A damaged project.json doesn't stop the project opening; project.sync has everything.
    }
  }
  return { dir, projectId, title }
}

/** Projects in the vault's folders that this server doesn't have (made or copied elsewhere). */
export async function vaultOnlyProjects(vault: FileSystemDirectoryHandle, known: readonly ProjectSummary[]): Promise<FolderProject[]> {
  const ids = new Set(known.map((p) => p.id))
  const found: FolderProject[] = []
  for (const dir of await subfolders(vault)) {
    const project = await readFolder(dir)
    if (project && !(project.projectId && ids.has(project.projectId))) found.push(project)
  }
  return found.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Opens a project folder in Weft: adds the project to this server (keeping its
 * id), or finds it if the server already has it, then uploads any pictures and
 * clips the server is missing. The folder stays linked, so Weft keeps it up to
 * date. Returns the project id.
 */
export async function openFolder(dir: FileSystemDirectoryHandle): Promise<{ id: string; existed: boolean; title: string }> {
  const found = await readFolder(dir)
  if (!found) throw new Error(`“${dir.name}” isn't a Weft project folder: there's no ${SYNC_FILE} in it. Pick the project's own folder.`)
  const state = new Uint8Array(await (await fileIn(dir, SYNC_FILE))!.arrayBuffer())
  const res = await fetch(`/api/projects/import${found.projectId ? `?id=${encodeURIComponent(found.projectId)}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: state,
    credentials: 'same-origin',
  })
  const body = (await res.json().catch(() => ({}))) as { project?: ProjectSummary; existed?: boolean; error?: string }
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

  await updateRecord(body.project.id, { folder: dir, off: false, adopt: true })
  return { id: body.project.id, existed: !!body.existed, title: body.project.title }
}

/** Asks for a folder, then opens it as above. */
export async function pickAndOpenFolder(): Promise<{ id: string; existed: boolean; title: string }> {
  return openFolder(await pickFolder('weft-open'))
}
