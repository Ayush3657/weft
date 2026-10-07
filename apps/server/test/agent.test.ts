import { HocuspocusProvider } from '@hocuspocus/provider'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Project, notesToMarkdown, shotLabels } from '@weft/model'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-agent-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')

type Running = Awaited<ReturnType<typeof startServer>>
type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }

let server: Running
let base = ''
let cookie = ''
let token = ''
let projectId = ''
let claude: Client
let watcher: { doc: Y.Doc; provider: HocuspocusProvider }

const origin = 'http://localhost:5173'

async function api(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', origin, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { res, json: (await res.json()) as Record<string, unknown> }
}

async function until(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await claude.callTool({ name, arguments: args })) as ToolResult
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n')

/** What someone with the project open in the app sees. */
const seen = () => new Project(watcher.doc).snapshot()

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Ayush', email: 'ayush@example.com' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const created = await api('POST', '/api/projects', { title: 'Skyline Towers 30s', type: 'ad', targetDuration: 30 })
  projectId = (created.json.project as { id: string }).id
  token = (await api('POST', '/api/tokens', { name: 'Claude' })).json.token as string

  claude = new Client({ name: 'test', version: '1.0.0' })
  await claude.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))

  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${server.port}/sync`, name: `project/${projectId}`, document: doc, token })
  await new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  watcher = { doc, provider }
})

afterAll(async () => {
  watcher?.provider.destroy()
  await claude?.close()
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('Claude through MCP', () => {
  it('shows the tools without a key, but only acts with one (a session cookie never counts)', async () => {
    const connectWith = async (headers: Record<string, string>) => {
      const client = new Client({ name: 'no-key', version: '1.0.0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }))
      return client
    }
    for (const [headers, message] of [
      [{}, "isn't connected to your account yet"],
      [{ cookie }, "isn't connected to your account yet"],
      [{ Authorization: 'Bearer weft_revoked-or-made-up' }, "doesn't recognise Claude's key"],
    ] as const) {
      const client = await connectWith(headers)
      expect((await client.listTools()).tools.length).toBeGreaterThan(20)
      const result = (await client.callTool({ name: 'list_projects', arguments: {} })) as ToolResult
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain(message)
      expect(textOf(result)).not.toContain('Skyline')
      await client.close()
    }
  })

  it('offers the tools and prompts', async () => {
    const { tools } = await claude.listTools()
    const names = tools.map((t) => t.name)
    for (const name of ['list_projects', 'get_project', 'get_cut', 'create_frames', 'update_frames', 'add_variation', 'set_timing', 'view_frames', 'attach_media', 'undo_changes']) {
      expect(names).toContain(name)
    }
    const { prompts } = await claude.listPrompts()
    expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['board_script', 'image_prompts', 'video_prompts', 'fit_cut', 'review_board']))
  })

  it('reads projects by title', async () => {
    expect(textOf(await call('list_projects', {}))).toContain('Skyline Towers 30s')
    const overview = textOf(await call('get_project', { project: 'skyline towers' }))
    expect(overview).toContain('Project "Skyline Towers 30s"')
    expect(overview).toContain('"Main cut" (main) · 0:03 of 0:30 target · 1 shots')
  })

  it('boards frames live, as one change set that the app can undo', async () => {
    await call('upsert_bible_entry', { project: projectId, kind: 'character', name: 'Priya', description: '34, architect, warm and wry.' })
    const added = await call('create_frames', {
      project: projectId,
      frames: [
        { description: 'Aerial over the towers at dawn', vo: 'Some homes you buy.', shot: 'ews', movement: 'push-in' },
        { description: 'Priya opens the balcony doors', vo: 'Some you grow into.', shot: 'ms', in_shot: ['Priya', 'Ravi'] },
        { description: 'Logo and CTA', on_screen_text: 'SKYLINE TOWERS', seconds: 2.5 },
      ],
    })
    expect(added.isError).toBeFalsy()
    expect(textOf(added)).toContain('Added 3 frames: 1')
    expect(textOf(added)).toContain('no bible entry called "Ravi"')

    // Someone with the project open sees it straight away; the empty first frame was used.
    await until(() => Object.keys(seen().frames).length === 3)
    const s = seen()
    const labels = shotLabels(s)
    const byLabel = (label: string) => Object.values(s.frames).find((f) => labels.get(f.id) === label)!
    expect(byLabel('1').description).toBe('Aerial over the towers at dawn')
    expect(byLabel('1').shotSize).toBe('ews')
    expect(byLabel('2').tags).toEqual([Object.values(s.bible)[0]!.id])
    expect(byLabel('3').durationMode).toBe('manual')

    await call('update_frames', { project: projectId, updates: [{ frame: '2', vo: 'Some homes you grow into, together.' }] })
    await until(() => byLabel('2') && seen().frames[byLabel('2').id]!.audio[0]?.text === 'Some homes you grow into, together.')

    const sets = Object.values(seen().changes)
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ agent: 'Claude', userName: 'Ayush', status: 'open', undoable: true })
    expect(sets[0]!.summary).toEqual(['Added Priya to the bible', 'Added frames 1, 2, 3', 'Changed VO in frame 2'])

    const cut = textOf(await call('get_cut', { project: projectId }))
    expect(cut).toContain('VO: Some homes you grow into, together.')
    expect(cut).toContain('In shot: Priya (character)')
    const script = textOf(await call('get_script', { project: projectId }))
    expect(script).toContain('| 3 | Logo and CTA |   | SKYLINE TOWERS | 2.5s |')

    // Someone edits the frame Claude made; undoing Claude's changes keeps their edit only if it survives.
    const undo = await api('POST', `/api/projects/${projectId}/changes/${sets[0]!.id}/undo`)
    expect(undo.res.status).toBe(200)
    await until(() => Object.keys(seen().frames).length === 1 && Object.keys(seen().bible).length === 0)
    expect(Object.values(seen().frames)[0]!.description).toBe('')
    expect(seen().changes[sets[0]!.id]!.status).toBe('undone')
  })

  it('starts a new change set after the last one was undone, and undoes it on request', async () => {
    await call('create_frames', { project: projectId, frames: [{ description: 'Kid presses the lift button' }] })
    await until(() => Object.values(seen().frames).some((f) => f.description === 'Kid presses the lift button'))
    const open = Object.values(seen().changes).filter((c) => c.status === 'open')
    expect(open).toHaveLength(1)
    const undone = await call('undo_changes', { project: projectId })
    expect(textOf(undone)).toContain('Undid 1 edit')
    await until(() => !Object.values(seen().frames).some((f) => f.description === 'Kid presses the lift button'))
  })

  it('adds variations and cutdowns without touching the original cut', async () => {
    await call('create_frames', {
      project: projectId,
      frames: [
        { description: 'Wide of the lobby', vo: 'Welcome home, to a place that grows with you and yours.' },
        { description: 'Packshot', seconds: 3 },
      ],
    })
    const variation = await call('add_variation', { project: projectId, frame: '1', changes: { vo: 'Welcome home.' }, use_in_cut: false })
    expect(textOf(variation)).toContain('Added variation 1B')
    const cutdown = await call('create_cut', { project: projectId, name: '15s', target_seconds: 15 })
    expect(textOf(cutdown)).toContain('Made "15s"')
    await call('set_cut', { project: projectId, cut: '15s', use: ['1B'] })
    await call('set_timing', { project: projectId, cut: '15s', lengths: [{ frame: '2', seconds: 1.5 }] })
    await until(() => Object.values(seen().cuts).some((c) => c.name === '15s' && Object.values(c.overrides).includes(1.5)))
    const s = seen()
    const labels = shotLabels(s)
    const main = Object.values(s.cuts).find((c) => c.isMain)!
    const short = Object.values(s.cuts).find((c) => c.name === '15s')!
    const frameAt = (label: string) => Object.values(s.frames).find((f) => labels.get(f.id) === label)!.id
    expect(short.overrides[frameAt('2')]).toBe(1.5)
    expect(main.overrides[frameAt('2')]).toBeUndefined()
    expect(textOf(await call('get_cut', { project: projectId, cut: '15s' }))).toContain('VO: Welcome home.')
  })

  it('attaches pictures and shows them back', async () => {
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#d9a066' } }).png().toBuffer()
    const hash = createHash('sha256').update(png).digest('hex')
    const put = await fetch(`${base}/api/media/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png })
    expect(put.status).toBe(200)
    const attached = await call('attach_media', { project: projectId, to: 'frame_picture', frame: '1A', hash, name: 'render_0001.png' })
    expect(textOf(attached)).toContain('Attached render_0001.png (image)')
    await until(() => Object.values(seen().frames).some((f) => f.heroMediaId))
    const asset = Object.values(seen().assets).find((a) => a.hash === hash)!
    expect([asset.width, asset.height]).toEqual([640, 360])

    const fromPath = await call('attach_media', { project: projectId, to: 'frame_picture', frame: '1A', path: 'C:/renders/shot.png' })
    expect(fromPath.isError).toBe(true)

    const sheet = await call('view_frames', { project: projectId })
    expect(sheet.content.some((c) => c.type === 'image' && c.mimeType === 'image/jpeg' && (c.data?.length ?? 0) > 1000)).toBe(true)
    const one = await call('view_frames', { project: projectId, frames: ['1A'] })
    expect(one.content.filter((c) => c.type === 'image')).toHaveLength(1)
  })

  it('writes notes and moodboard items', async () => {
    await call('add_note', { project: projectId, markdown: '## Shot ideas\n- Reflection of the towers in the kid\'s eye\n- **Golden hour** only', page: 'Ideas' })
    await until(() => Object.values(seen().pages).some((p) => p.title === 'Ideas'))
    const page = Object.values(seen().pages).find((p) => p.title === 'Ideas')!
    await until(() => notesToMarkdown(new Project(watcher.doc).pageFragment(page.id)).includes('Golden hour'))
    expect(notesToMarkdown(new Project(watcher.doc).pageFragment(page.id))).toBe(
      "## Shot ideas\n\n- Reflection of the towers in the kid's eye\n- **Golden hour** only",
    )
    expect(textOf(await call('get_notes', { project: projectId, page: 'ideas' }))).toContain('**Golden hour** only')
    await call('add_to_moodboard', { project: projectId, notes: ['Warm, unhurried'], colors: ['#D9A066'] })
    await until(() => Object.keys(seen().moodboard).length === 2)
    const board = textOf(await call('get_moodboard', { project: projectId }))
    expect(board).toContain('note: Warm, unhurried')
    expect(board).toContain('colour #D9A066')
    expect(textOf(await call('search', { project: projectId, query: 'golden' }))).toContain('Notes "Ideas"')
  })

  it('explains mistakes instead of failing', async () => {
    const missing = await call('update_frames', { project: projectId, updates: [{ frame: '99', description: 'x' }] })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain('No frame "99"')
    const project = await call('get_cut', { project: 'nothing like this' })
    expect(textOf(project)).toContain('No project "nothing like this"')
  })
})
