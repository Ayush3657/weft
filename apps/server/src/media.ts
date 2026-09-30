import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { config } from './config'
import { db, type MediaRow } from './db'

export const HASH_PATTERN = /^[a-f0-9]{64}$/

const mediaDir = path.join(config.dataDir, 'media')
const tmpDir = path.join(config.dataDir, 'tmp')
mkdirSync(mediaDir, { recursive: true })
mkdirSync(tmpDir, { recursive: true })

/** Files are stored by the SHA-256 of their contents, so identical uploads are kept once. */
function mediaPath(hash: string): string {
  return path.join(mediaDir, hash.slice(0, 2), hash.slice(2, 4), hash)
}

export function getMedia(hash: string): MediaRow | null {
  if (!HASH_PATTERN.test(hash)) return null
  const row = db.prepare('SELECT * FROM media WHERE hash = ?').get(hash) as MediaRow | undefined
  return row && existsSync(mediaPath(hash)) ? row : null
}

export class UploadError extends Error {
  readonly status: 400 | 413

  constructor(status: 400 | 413, message: string) {
    super(message)
    this.status = status
  }
}

/** Streams an upload to disk, checking its size and that its contents match `hash`. */
export async function storeMedia(
  body: ReadableStream<Uint8Array>,
  hash: string,
  mime: string,
  userId: string,
): Promise<MediaRow> {
  const existing = getMedia(hash)
  if (existing) return existing

  const tmp = path.join(tmpDir, randomUUID())
  const hasher = createHash('sha256')
  let size = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp)
      const input = Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
      input.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > config.maxUploadBytes) {
          input.destroy(new UploadError(413, 'That file is too large'))
          return
        }
        hasher.update(chunk)
      })
      input.on('error', reject)
      out.on('error', reject)
      out.on('finish', resolve)
      input.pipe(out)
    })
    if (hasher.digest('hex') !== hash) throw new UploadError(400, "The file doesn't match its hash")
    const target = mediaPath(hash)
    mkdirSync(path.dirname(target), { recursive: true })
    renameSync(tmp, target)
  } finally {
    rmSync(tmp, { force: true })
  }

  const row: MediaRow = { hash, mime: mime || 'application/octet-stream', size, created_at: Date.now(), created_by: userId }
  db.prepare(
    'INSERT OR IGNORE INTO media (hash, mime, size, created_at, created_by) VALUES (@hash, @mime, @size, @created_at, @created_by)',
  ).run(row)
  return row
}

/** A response for the file, honouring Range requests so video can seek. */
export function mediaResponse(row: MediaRow, range: string | undefined): Response {
  const file = mediaPath(row.hash)
  const size = statSync(file).size
  const headers = new Headers({
    'Content-Type': row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: `"${row.hash}"`,
  })
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (match && (match[1] || match[2])) {
    let start: number
    let end: number
    if (match[1]) {
      start = Number(match[1])
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    } else {
      const suffix = Number(match[2])
      start = Math.max(0, size - suffix)
      end = size - 1
    }
    if (start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
    return new Response(stream, { status: 206, headers })
  }
  headers.set('Content-Length', String(size))
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(stream, { status: 200, headers })
}
