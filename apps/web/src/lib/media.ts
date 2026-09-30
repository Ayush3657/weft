import type { AssetKind, Project } from '@weft/model'
import { createSHA256 } from 'hash-wasm'
import { api } from './api'
import { toast } from './toast'

export const mediaUrl = (hash: string) => `/api/media/${hash}`

export function fileKind(mime: string): Exclude<AssetKind, 'link'> | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

/**
 * SHA-256 in chunks, so big videos don't need to fit in memory. Uses WASM so it
 * also works on plain-http LAN addresses, where crypto.subtle isn't available.
 */
async function hashFile(file: Blob): Promise<string> {
  const hasher = await createSHA256()
  hasher.init()
  const chunk = 8 * 1024 * 1024
  for (let offset = 0; offset < file.size; offset += chunk) {
    hasher.update(new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer()))
  }
  return hasher.digest('hex')
}

export interface MediaMeta {
  width?: number | null
  height?: number | null
  duration?: number | null
}

async function probe(file: File, kind: Exclude<AssetKind, 'link'>): Promise<MediaMeta> {
  const url = URL.createObjectURL(file)
  try {
    if (kind === 'image') {
      const img = new Image()
      img.src = url
      await img.decode()
      return { width: img.naturalWidth, height: img.naturalHeight }
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    el.preload = 'metadata'
    el.src = url
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve()
      el.onerror = () => reject(new Error('Unreadable media'))
    })
    const duration = Number.isFinite(el.duration) ? el.duration : null
    if (el instanceof HTMLVideoElement) return { width: el.videoWidth, height: el.videoHeight, duration }
    return { duration }
  } catch {
    return {}
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Uploads a file (skipping it if the server already has it) and adds it to the
 * project's library. `known` fills in what the file can't tell us, like the
 * length of a fresh recording.
 */
export async function importFile(project: Project, file: File, userId: string, known: MediaMeta = {}): Promise<string> {
  const kind = fileKind(file.type)
  if (!kind) throw new Error(`${file.name || 'That file'} isn't an image, video or audio file`)
  const hash = await hashFile(file)
  const { exists } = await api<{ exists: boolean }>(`/api/media/${hash}/exists`)
  if (!exists) {
    const res = await fetch(mediaUrl(hash), {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
      credentials: 'same-origin',
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Couldn't upload ${file.name}`)
    }
  }
  const probed = await probe(file, kind)
  const meta: MediaMeta = {
    width: known.width ?? probed.width,
    height: known.height ?? probed.height,
    duration: known.duration ?? probed.duration,
  }
  return project.addAsset({
    kind,
    hash,
    name: file.name,
    mime: file.type,
    size: file.size,
    width: meta.width ?? null,
    height: meta.height ?? null,
    duration: meta.duration ?? null,
    createdBy: userId,
  })
}

/** Imports several files, reporting failures as toasts. Returns the asset ids that worked. */
export async function importFiles(project: Project, files: Iterable<File>, userId: string): Promise<string[]> {
  const ids: string[] = []
  for (const file of files) {
    try {
      ids.push(await importFile(project, file, userId))
    } catch (error) {
      toast(error instanceof Error ? error.message : `Couldn't import ${file.name}`, 'error')
    }
  }
  return ids
}

/** Media files from a drag or paste event. */
export function mediaFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  return [...data.files].filter((f) => fileKind(f.type) !== null)
}
