import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { config } from './config'
import { getMedia, mediaFile } from './media'

/** The widths (and heights) the app asks for: thumbnails, cards, panels, the player. */
export const PREVIEW_SIZES = [320, 640, 1280, 1920] as const
export type PreviewSize = (typeof PREVIEW_SIZES)[number]

const previewDir = path.join(config.dataDir, 'previews')
mkdirSync(previewDir, { recursive: true })

// Animated GIFs would stop moving and SVGs already scale, so those are always shown as they are.
const RESIZABLE = /^image\/(png|jpe?g|webp|avif|tiff|bmp|heic|heif)$/

const pending = new Map<string, Promise<string | null>>()

/**
 * A smaller copy of a picture, at most `size` pixels on its longest side, as
 * WebP. Made the first time it's asked for and kept next to the media. A
 * pasted 4K PNG of 17 MB becomes a card preview of about 40 KB. Null when the
 * file isn't a picture that can be resized.
 */
export function mediaPreview(hash: string, size: PreviewSize): Promise<string | null> {
  const row = getMedia(hash)
  const source = row && RESIZABLE.test(row.mime) ? mediaFile(hash) : null
  if (!source) return Promise.resolve(null)
  const out = path.join(previewDir, hash.slice(0, 2), `${hash}-${size}.webp`)
  if (existsSync(out)) return Promise.resolve(out)
  const key = `${hash}-${size}`
  let job = pending.get(key)
  if (!job) {
    job = (async () => {
      mkdirSync(path.dirname(out), { recursive: true })
      const tmp = `${out}.${randomUUID()}.tmp`
      try {
        await sharp(source, { animated: false })
          .rotate()
          .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(tmp)
        renameSync(tmp, out)
        return out
      } catch {
        return null
      } finally {
        rmSync(tmp, { force: true })
      }
    })().finally(() => pending.delete(key))
    pending.set(key, job)
  }
  return job
}

let warming: Promise<void> = Promise.resolve()
let stopping = false

/**
 * Makes a new picture's previews in the background, one picture at a time,
 * so they're ready the first time anyone looks (the player's first play
 * included). Previews asked for meanwhile are made straight away as usual.
 */
export function warmPreviews(hash: string): void {
  warming = warming.then(async () => {
    for (const size of [640, 320, 1920, 1280] as const) {
      if (stopping || !existsSync(previewDir)) return
      await mediaPreview(hash, size)
    }
  })
}

/** Lets the preview being made finish and skips the rest, for shutting down. */
export async function stopWarming(): Promise<void> {
  stopping = true
  await warming
}
