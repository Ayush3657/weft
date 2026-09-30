import { HocuspocusProvider } from '@hocuspocus/provider'
import { Project } from '@weft/model'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { hocuspocus } = await import('../src/sync')
const { db } = await import('../src/db')

type Running = Awaited<ReturnType<typeof startServer>>

let server: Running
let base = ''
let cookie = ''
let token = ''
let projectId = ''

const origin = 'http://localhost:5173'

async function api(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', origin, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { res, json: (await res.json()) as Record<string, unknown> }
}

function connect(authToken: string) {
  const doc = new Y.Doc()
  let failed: string | null = null
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${server.port}/sync`,
    name: `project/${projectId}`,
    document: doc,
    token: authToken,
    onAuthenticationFailed: ({ reason }) => {
      failed = reason
    },
  })
  const synced = new Promise<void>((resolve) => {
    if (provider.isSynced) resolve()
    provider.on('synced', () => resolve())
  })
  return { doc, provider, synced, failed: () => failed }
}

async function until(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
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
  const created = await api('POST', '/api/projects', { title: 'Sync test', type: 'ad' })
  projectId = (created.json.project as { id: string }).id
  const tokenRes = await api('POST', '/api/tokens', { name: 'test' })
  token = tokenRes.json.token as string
})

afterAll(async () => {
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('live sync', () => {
  it('loads the project the server created', async () => {
    const a = connect(token)
    await a.synced
    const s = new Project(a.doc).snapshot()
    expect(s.meta.title).toBe('Sync test')
    expect(Object.keys(s.frames)).toHaveLength(1)
    a.provider.destroy()
  })

  it('syncs edits between clients and keeps them after the document unloads', async () => {
    const a = connect(token)
    const b = connect(token)
    await Promise.all([a.synced, b.synced])
    const pa = new Project(a.doc)
    const pb = new Project(b.doc)
    const first = Object.keys(pa.snapshot().frames)[0]!
    pa.setText(first, 'description', 'Aerial of the towers at dusk')
    pa.appendFrame()
    await until(() => Object.keys(pb.snapshot().frames).length === 2)
    expect(pb.getFrame(first)?.description).toBe('Aerial of the towers at dusk')

    a.provider.destroy()
    b.provider.destroy()
    await until(() => hocuspocus.getDocumentsCount() === 0)

    const c = connect(token)
    await c.synced
    const pc = new Project(c.doc)
    expect(Object.keys(pc.snapshot().frames)).toHaveLength(2)
    expect(pc.getFrame(first)?.description).toBe('Aerial of the towers at dusk')
    c.provider.destroy()
  })

  it('refuses a bad token', async () => {
    const bad = connect('weft_not-a-real-token')
    await until(() => bad.failed() !== null)
    expect(bad.provider.isSynced).toBe(false)
    bad.provider.destroy()
  })

  it('updates the project list title from the document', async () => {
    const a = connect(token)
    await a.synced
    new Project(a.doc).updateMeta({ title: 'Renamed in the app' })
    a.provider.destroy()
    await until(() => hocuspocus.getDocumentsCount() === 0)
    const list = await api('GET', '/api/projects')
    const project = (list.json.projects as Array<{ id: string; title: string }>).find((p) => p.id === projectId)
    expect(project?.title).toBe('Renamed in the app')
  })
})
