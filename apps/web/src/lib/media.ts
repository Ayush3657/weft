import { Project, type AssetKind } from '@weft/model'
import { createSHA256 } from 'hash-wasm'
import { useSyncExternalStore } from 'react'
import { ApiError, api } from './api'
import { toast } from './toast'

export const mediaUrl = (hash: string) => `/api/media/${hash}`

/** Preview widths the server makes: thumbnails, cards, panels, the player. */
export type PreviewSize = 320 | 640 | 1280 | 1920
/** A small copy of a picture (the server falls back to the original for anything it can't resize). */
export const previewUrl = (hash: string, size: PreviewSize) => `/api/media/${hash}/preview/${size}`

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

// ------------------------------------------------------ files kept in memory

/**
 * Files added in this browser are shown straight from memory, so they appear
 * the moment they're dropped or pasted while the upload runs in the background.
 */
const local = new Map<string, { url: string; size: number }>()
/** Oldest uploaded files are let go past this, and load from the server instead. */
const LOCAL_BUDGET = 512 * 1024 * 1024

function keepLocal(hash: string, file: File): void {
  if (local.has(hash)) return
  local.set(hash, { url: URL.createObjectURL(file), size: file.size })
  let total = [...local.values()].reduce((n, entry) => n + entry.size, 0)
  for (const [key, entry] of local) {
    if (total <= LOCAL_BUDGET) break
    if (key === hash || uploads.has(key)) continue
    URL.revokeObjectURL(entry.url)
    local.delete(key)
    total -= entry.size
  }
}

/**
 * Where to show a file from. Pictures given a `size` come from the server's
 * preview of about that size, or from memory while they're still uploading
 * from here. Everything else (video, sound, full size) comes from memory if it
 * was added here, otherwise the original on the server.
 */
export function displayUrl(hash: string, size?: PreviewSize): string {
  const kept = local.get(hash)
  if (size) return kept && uploads.has(hash) ? kept.url : previewUrl(hash, size)
  return kept?.url ?? mediaUrl(hash)
}

// ------------------------------------------------------------------ uploads

const uploads = new Map<string, Promise<void>>()
let uploadingSnapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function changed() {
  uploadingSnapshot = new Set(uploads.keys())
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Hashes of files this browser is still uploading. */
export function useUploading(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => uploadingSnapshot)
}

// Leaving mid-upload would leave the project pointing at files the server never got.
window.addEventListener('beforeunload', (e) => {
  if (!uploads.size) return
  e.preventDefault()
  e.returnValue = ''
})

class UploadError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

async function putFile(file: File, hash: string): Promise<void> {
  const { exists } = await api<{ exists: boolean }>(`/api/media/${hash}/exists`)
  if (exists) return
  const res = await fetch(mediaUrl(hash), {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new UploadError(data.error ?? `Upload failed (${res.status})`, res.status >= 500 || res.status === 408 || res.status === 429)
  }
}

const isRetryable = (error: unknown) =>
  error instanceof UploadError ? error.retryable : error instanceof ApiError ? error.status >= 500 : true

/** Uploads a file once (however many times it's added), retrying brief network trouble. */
function upload(file: File, hash: string): Promise<void> {
  const running = uploads.get(hash)
  if (running) return running
  const task = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await putFile(file, hash)
      } catch (error) {
        if (attempt >= 3 || !isRetryable(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt))
      }
    }
  })().finally(() => {
    uploads.delete(hash)
    changed()
  })
  uploads.set(hash, task)
  changed()
  return task
}

// -------------------------------------------------------------------- import

export interface MediaMeta {
  width?: number | null
  height?: number | null
  duration?: number | null
}

/** Size and length, read from the file's header rather than decoding it all. */
async function probe(url: string, kind: Exclude<AssetKind, 'link'>): Promise<MediaMeta> {
  try {
    if (kind === 'image') {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Unreadable image'))
        img.src = url
      })
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
    const meta = el instanceof HTMLVideoElement ? { width: el.videoWidth, height: el.videoHeight, duration } : { duration }
    el.removeAttribute('src')
    return meta
  } catch {
    return {}
  }
}

/** Clipboard pictures all arrive as "image.png"; name them so they can be told apart in the Library. */
function assetName(file: File): string {
  if (!/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) return file.name
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `Pasted image ${time}`
}

/**
 * Adds a file to the project's library. It's ready to use as soon as it's
 * hashed: this browser shows it from memory while it uploads in the
 * background (skipped if the server already has it). If the upload fails for
 * good, the file is taken back out. `known` fills in what the file can't tell
 * us, like the length of a fresh recording.
 */
export async function importFile(project: Project, file: File, userId: string, known: MediaMeta = {}): Promise<string> {
  const kind = fileKind(file.type)
  if (!kind) throw new Error(`${file.name || 'That file'} isn't an image, video or audio file`)
  const hash = await hashFile(file)
  const name = assetName(file)
  keepLocal(hash, file)
  const probed = await probe(displayUrl(hash), kind)
  const isNew = ![...project.assets.values()].some((m) => m.get('hash') === hash)
  const assetId = project.addAsset({
    kind,
    hash,
    name,
    mime: file.type,
    size: file.size,
    width: known.width ?? probed.width ?? null,
    height: known.height ?? probed.height ?? null,
    duration: known.duration ?? probed.duration ?? null,
    createdBy: userId,
  })
  upload(file, hash).catch((error: unknown) => {
    // Without its file the asset would show as missing for everyone.
    if (isNew && project.assets.has(assetId)) new Project(project.doc, { source: 'upload' }).deleteAsset(assetId)
    const reason = error instanceof Error && error.message ? ` (${error.message})` : ''
    toast(`${name || 'A file'} didn't upload${reason}, so it was taken out. Try adding it again.`, 'error')
  })
  return assetId
}

/** Puts a file on the server (if it isn't there yet) without adding it to a project. Returns its hash. */
export async function uploadMedia(file: File): Promise<string> {
  const hash = await hashFile(file)
  await upload(file, hash)
  return hash
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
