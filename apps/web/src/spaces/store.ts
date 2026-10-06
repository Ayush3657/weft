import { useSyncExternalStore } from 'react'
import { api, type FolderInfo, type ProjectSummary, type SpaceContents, type SpaceSummary } from '../lib/api'
import { keeper } from '../vault/keeper'

/**
 * Spaces and what's in them, kept from the last time they loaded so the
 * projects page shows at once and refreshes in the background.
 */

let spaces: SpaceSummary[] | null = null
const contents = new Map<string, SpaceContents>()
let version = 0
const listeners = new Set<() => void>()

function changed(): void {
  version++
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const useVersion = () => useSyncExternalStore(subscribe, () => version)

export function useSpaces(): SpaceSummary[] | null {
  useVersion()
  return spaces
}

export function useContents(spaceId: string | null): SpaceContents | null {
  useVersion()
  return spaceId ? (contents.get(spaceId) ?? null) : null
}

export async function refreshSpaces(): Promise<SpaceSummary[]> {
  const result = await api<{ spaces: SpaceSummary[] }>('/api/spaces')
  spaces = result.spaces
  changed()
  return result.spaces
}

export async function refreshContents(spaceId: string): Promise<SpaceContents> {
  const result = await api<SpaceContents>(`/api/spaces/${spaceId}/contents`)
  contents.set(spaceId, result)
  changed()
  return result
}

/** Reloads the list of spaces and what's in the given ones. */
export async function reload(...spaceIds: string[]): Promise<void> {
  await Promise.all([refreshSpaces(), ...[...new Set(spaceIds)].map((id) => refreshContents(id).catch(() => contents.delete(id)))])
  // Something moved, was renamed or was made: the vault follows.
  keeper.soon()
}

// --------------------------------------------------------------- changes

export async function createSpace(name: string): Promise<SpaceSummary> {
  const { space } = await api<{ space: SpaceSummary }>('/api/spaces', { method: 'POST', body: { name } })
  await reload(space.id)
  return space
}

export async function updateSpace(spaceId: string, patch: { name?: string; about?: string }): Promise<void> {
  await api(`/api/spaces/${spaceId}`, { method: 'PATCH', body: patch })
  await reload(spaceId)
}

export async function deleteSpace(spaceId: string): Promise<void> {
  await api(`/api/spaces/${spaceId}`, { method: 'DELETE' })
  contents.delete(spaceId)
  await reload()
}

export async function createFolder(spaceId: string, parentId: string | null, name: string): Promise<FolderInfo> {
  const { folder } = await api<{ folder: FolderInfo }>('/api/folders', { method: 'POST', body: { spaceId, parentId, name } })
  await reload(spaceId)
  return folder
}

export async function updateFolder(folder: FolderInfo, patch: { name?: string; parentId?: string | null; about?: string }): Promise<void> {
  await api(`/api/folders/${folder.id}`, { method: 'PATCH', body: patch })
  await reload(folder.spaceId)
}

export async function deleteFolder(folder: FolderInfo): Promise<void> {
  await api(`/api/folders/${folder.id}`, { method: 'DELETE' })
  await reload(folder.spaceId)
}

export async function moveProject(project: ProjectSummary, to: { spaceId: string; folderId: string | null }): Promise<void> {
  await api(`/api/projects/${project.id}`, { method: 'PATCH', body: to })
  await reload(project.spaceId, to.spaceId)
}

export async function deleteProject(project: ProjectSummary): Promise<void> {
  await api(`/api/projects/${project.id}`, { method: 'DELETE' })
  await reload(project.spaceId)
}

// ---------------------------------------------------------------- helpers

export const childrenOf = (folders: readonly FolderInfo[], parentId: string | null) =>
  folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

/** From the space's top level down to this folder. */
export function ancestors(folders: readonly FolderInfo[], folderId: string | null): FolderInfo[] {
  const path: FolderInfo[] = []
  for (let id = folderId; id; ) {
    const folder = folders.find((f) => f.id === id)
    if (!folder || path.includes(folder)) break
    path.unshift(folder)
    id = folder.parentId
  }
  return path
}

/** The folder and every folder inside it. */
export function within(folders: readonly FolderInfo[], folderId: string): Set<string> {
  const ids = new Set([folderId])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id)
        grew = true
      }
    }
  }
  return ids
}

/** How many storyboards are in a folder, counting the folders inside it. */
export function countIn(c: SpaceContents, folderId: string): number {
  const ids = within(c.folders, folderId)
  return c.projects.filter((p) => p.folderId && ids.has(p.folderId)).length
}
