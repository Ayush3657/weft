import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-media-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')

let server: Awaited<ReturnType<typeof startServer>>
let base = ''
let cookie = ''
const origin = 'http://localhost:5173'

async function upload(data: Buffer, type: string): Promise<string> {
  const hash = createHash('sha256').update(data).digest('hex')
  const res = await fetch(`${base}/api/media/${hash}`, { method: 'PUT', headers: { cookie, origin, 'content-type': type }, body: data })
  expect(res.status).toBe(200)
  return hash
}

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Tester', email: 'tester@example.com' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
})

afterAll(async () => {
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('picture previews', () => {
  it('makes a small WebP of a big picture, once, and lets the browser keep it', async () => {
    // A 4K frame with noise in it compresses about as badly as a pasted render.
    const raw = Buffer.alloc(3840 * 2160 * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
    const big = await sharp(raw, { raw: { width: 3840, height: 2160, channels: 3 } }).png().toBuffer()
    const hash = await upload(big, 'image/png')

    const res = await fetch(`${base}/api/media/${hash}/preview/640`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const preview = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(preview).metadata()
    expect([meta.width, meta.height]).toEqual([640, 360])
    expect(preview.length).toBeLessThan(big.length / 20)

    const again = await fetch(`${base}/api/media/${hash}/preview/640`, { headers: { cookie, 'if-none-match': res.headers.get('etag')! } })
    expect(again.status).toBe(304)
  })

  it("never enlarges, and hands back the original for what it can't resize", async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#335577' } }).png().toBuffer()
    const smallHash = await upload(small, 'image/png')
    const res = await fetch(`${base}/api/media/${smallHash}/preview/1280`, { headers: { cookie } })
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(200)

    const gif = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#ff0000' } }).gif().toBuffer()
    const gifHash = await upload(gif, 'image/gif')
    const redirect = await fetch(`${base}/api/media/${gifHash}/preview/320`, { headers: { cookie }, redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe(`/api/media/${gifHash}`)

    expect((await fetch(`${base}/api/media/${smallHash}/preview/500`, { headers: { cookie } })).status).toBe(400)
    expect((await fetch(`${base}/api/media/${'0'.repeat(64)}/preview/320`, { headers: { cookie } })).status).toBe(404)
  })
})
