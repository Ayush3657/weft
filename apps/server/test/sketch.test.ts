import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Project } from '@weft/model'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-sketch-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')
const { hocuspocus } = await import('../src/sync')
const { docName } = await import('../src/projects')

let server: Awaited<ReturnType<typeof startServer>>
let base = ''
let client: Client
let projectId = ''
const origin = 'http://localhost:5173'

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Ayush', email: 'ayush@example.com' }),
  })
  const user = ((await login.json()) as { user: { id: string } }).user
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const post = (pathname: string, body: unknown) =>
    fetch(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body) }).then(
      (r) => r.json() as Promise<Record<string, any>>,
    )
  projectId = (await post('/api/projects', { title: 'Thumbnails', type: 'ad' })).project.id
  const token = (await post('/api/tokens', { name: 'Claude' })).token as string

  // Someone sketches a thumbnail on the first frame: a figure, and an arrow for a push-in.
  const connection = await hocuspocus.openDirectConnection(docName(projectId), { user: { ...user, email: 'ayush@example.com', name: 'Ayush', avatarUrl: null }, projectId, via: 'session' })
  await connection.transact((doc) => {
    const p = new Project(doc)
    const frameId = Object.keys(p.snapshot().frames)[0]!
    p.addStroke(frameId, { tool: 'pen', color: '#161616', size: 10, points: [400, 150, 420, 300, 380, 420, 460, 420], pressure: false, createdBy: user.id })
    p.addStroke(frameId, { tool: 'arrow', color: '#e5484d', size: 5, points: [150, 450, 450, 300], pressure: false, createdBy: user.id })
  })
  await connection.disconnect()

  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
})

afterAll(async () => {
  await client?.close()
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

type Content = Array<{ type: string; text?: string; data?: string }>

describe('sketches, for Claude', () => {
  it('says a frame has a sketch', async () => {
    const result = (await client.callTool({ name: 'get_cut', arguments: { project: projectId } })) as { content: Content }
    expect(result.content[0]!.text).toContain('Sketch: 1 pen stroke and 1 arrow')
  })

  it('shows the sketch, on paper when there is no picture', async () => {
    const one = (await client.callTool({ name: 'view_frames', arguments: { project: projectId, frames: ['1'] } })) as { content: Content }
    expect(one.content[0]!.text).toContain('its sketch below')
    const picture = Buffer.from(one.content[1]!.data!, 'base64')
    const meta = await sharp(picture).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(16 / 9, 1)
    // Mostly paper, with ink on it.
    const stats = await sharp(picture).stats()
    expect(stats.channels[0]!.mean).toBeGreaterThan(200)
    expect(stats.channels[0]!.min).toBeLessThan(80)

    const sheet = (await client.callTool({ name: 'view_frames', arguments: { project: projectId } })) as { content: Content }
    expect(sheet.content[0]!.text).toContain('1 with pictures or sketches')
    expect(sheet.content[1]!.type).toBe('image')
  })
})
