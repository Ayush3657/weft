import { Project, initProject } from '@weft/model'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-import-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')
const { loadProjectState } = await import('../src/projects')

let server: Awaited<ReturnType<typeof startServer>>
let base = ''
let cookie = ''
const origin = 'http://localhost:5173'

const importState = (state: Uint8Array, id?: string) =>
  fetch(`${base}/api/projects/import${id ? `?id=${id}` : ''}`, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/octet-stream' },
    body: state,
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as { project?: { id: string; title: string }; existed?: boolean; error?: string } }))

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

describe('opening a project folder', () => {
  it('adds the project under its own id, with everything in it', async () => {
    // A project saved to a folder somewhere else.
    const doc = new Y.Doc()
    const { firstFrameId } = initProject(doc, { title: 'From the vault', type: 'film' })
    new Project(doc).setText(firstFrameId, 'description', 'Opening shot from the folder')
    const state = Y.encodeStateAsUpdate(doc)

    const first = await importState(state, 'VaultProj123')
    expect(first.status).toBe(201)
    expect(first.json).toMatchObject({ existed: false, project: { id: 'VaultProj123', title: 'From the vault' } })

    const list = await fetch(`${base}/api/projects`, { headers: { cookie } }).then((r) => r.json() as Promise<{ projects: Array<{ id: string; type: string }> }>)
    expect(list.projects.find((p) => p.id === 'VaultProj123')?.type).toBe('film')
    const stored = new Y.Doc()
    Y.applyUpdate(stored, loadProjectState('VaultProj123')!)
    expect(new Project(stored).getFrame(firstFrameId)?.description).toBe('Opening shot from the folder')

    // Opening it again finds the same project instead of making a copy.
    const again = await importState(state, 'VaultProj123')
    expect(again.status).toBe(200)
    expect(again.json.existed).toBe(true)
  })

  it('gives a new id when there is none, and refuses files that are not projects', async () => {
    const doc = new Y.Doc()
    initProject(doc, { title: 'No id' })
    const fresh = await importState(Y.encodeStateAsUpdate(doc))
    expect(fresh.status).toBe(201)
    expect(fresh.json.project?.id).toMatch(/^[A-Za-z0-9]{6,32}$/)

    expect((await importState(new Uint8Array([1, 2, 3, 4]))).status).toBe(400)
    const empty = new Y.Doc()
    empty.getMap('meta').set('title', 'Not really a project')
    expect((await importState(Y.encodeStateAsUpdate(empty))).json.error).toBe("That file isn't a Weft project")
  })
})
