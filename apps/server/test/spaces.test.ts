import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-spaces-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')

let server: Awaited<ReturnType<typeof startServer>>
let base = ''
const origin = 'http://localhost:5173'

type Json = Record<string, any>
interface Person {
  cookie: string
  id: string
  call: (method: string, pathname: string, body?: unknown) => Promise<{ status: number; json: Json }>
  claude: (name: string, args: Json) => Promise<{ isError?: boolean; text: string }>
}

async function signIn(name: string, email: string): Promise<Person> {
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name, email }),
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const id = ((await login.json()) as Json).user.id as string
  const call = async (method: string, pathname: string, body?: unknown) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { cookie, origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
  }
  let token = ''
  const claude = async (tool: string, args: Json) => {
    token ||= (await call('POST', '/api/tokens', { name: 'Claude (test)' })).json.token as string
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const result = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> }
    await client.close()
    return { isError: result.isError, text: result.content.map((c) => c.text ?? '').join('\n') }
  }
  return { cookie, id, call, claude }
}

let ayush: Person
let teammate: Person
let outsider: Person

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  ayush = await signIn('Ayush', 'ayush@example.com')
  teammate = await signIn('Priya', 'priya@example.com')
  outsider = await signIn('Someone else', 'else@example.com')
})

afterAll(async () => {
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

let team = ''
let broadway = ''
let festive = ''
let launch = ''

describe('spaces', () => {
  it('starts everyone with a personal space that only they see', async () => {
    const { json } = await ayush.call('GET', '/api/spaces')
    expect(json.spaces).toMatchObject([{ name: 'Personal', kind: 'personal', role: 'owner', members: 1 }])
    const mine = (await ayush.call('POST', '/api/projects', { title: 'Short film draft', type: 'film' })).json.project
    expect(mine.spaceId).toBe(json.spaces[0].id)
    expect((await teammate.call('GET', '/api/projects')).json.projects).toEqual([])
    expect((await teammate.call('GET', `/api/projects/${mine.id}`)).status).toBe(404)
  })

  it('shares a team space with the people added to it, now or when they first sign in', async () => {
    team = (await ayush.call('POST', '/api/spaces', { name: 'ASBL Ads' })).json.space.id
    const added = await ayush.call('POST', `/api/spaces/${team}/members`, { email: 'Priya@Example.com' })
    expect(added.json.added).toBe('member')
    expect((await ayush.call('POST', `/api/spaces/${team}/members`, { email: 'later@example.com' })).json.invites).toEqual(['later@example.com'])
    // Only owners add people.
    expect((await teammate.call('POST', `/api/spaces/${team}/members`, { email: 'x@example.com' })).status).toBe(403)

    const later = await signIn('Later', 'later@example.com')
    expect((await later.call('GET', '/api/spaces')).json.spaces.map((s: Json) => s.name)).toEqual(['Personal', 'ASBL Ads'])
    const members = (await ayush.call('GET', `/api/spaces/${team}/members`)).json
    expect(members.members.map((m: Json) => [m.name, m.role])).toEqual([
      ['Ayush', 'owner'],
      ['Later', 'member'],
      ['Priya', 'member'],
    ])
    expect(members.invites).toEqual([])
    expect((await outsider.call('GET', `/api/spaces/${team}/contents`)).status).toBe(404)

    // People can leave; the last owner can't.
    expect((await later.call('DELETE', `/api/spaces/${team}/members/${later.id}`)).status).toBe(200)
    expect((await ayush.call('DELETE', `/api/spaces/${team}/members/${ayush.id}`)).status).toBe(409)
  })

  it('nests folders, keeps names unique side by side, and never puts a folder inside itself', async () => {
    broadway = (await ayush.call('POST', '/api/folders', { spaceId: team, name: 'Broadway' })).json.folder.id
    festive = (await teammate.call('POST', '/api/folders', { spaceId: team, parentId: broadway, name: 'Festive' })).json.folder.id
    expect((await ayush.call('POST', '/api/folders', { spaceId: team, name: 'broadway' })).status).toBe(409)
    expect((await ayush.call('PATCH', `/api/folders/${broadway}`, { parentId: festive })).status).toBe(400)
    expect((await outsider.call('POST', '/api/folders', { spaceId: team, name: 'Mine now' })).status).toBe(404)
    const contents = (await teammate.call('GET', `/api/spaces/${team}/contents`)).json
    expect(contents.folders.map((f: Json) => [f.name, f.parentId])).toEqual([
      ['Broadway', null],
      ['Festive', broadway],
    ])
  })

  it('makes and moves storyboards between folders and spaces', async () => {
    launch = (await ayush.call('POST', '/api/projects', { title: 'Broadway launch 30s', type: 'ad', spaceId: team, folderId: broadway })).json.project.id
    const seen = (await teammate.call('GET', `/api/spaces/${team}/contents`)).json.projects
    expect(seen).toMatchObject([{ id: launch, folderId: broadway }])
    expect((await teammate.call('GET', `/api/projects/${launch}`)).json).toMatchObject({ space: { name: 'ASBL Ads' }, path: [{ name: 'Broadway' }] })

    await teammate.call('PATCH', `/api/projects/${launch}`, { spaceId: team, folderId: festive })
    expect((await ayush.call('GET', `/api/projects/${launch}`)).json.path.map((p: Json) => p.name)).toEqual(['Broadway', 'Festive'])

    // Into Ayush's own space: the team stops seeing it. Priya can't move it into a space she isn't in.
    const personal = (await ayush.call('GET', '/api/spaces')).json.spaces[0].id
    expect((await teammate.call('PATCH', `/api/projects/${launch}`, { spaceId: personal, folderId: null })).status).toBe(404)
    await ayush.call('PATCH', `/api/projects/${launch}`, { spaceId: personal, folderId: null })
    expect((await teammate.call('GET', `/api/projects/${launch}`)).status).toBe(404)
    await ayush.call('PATCH', `/api/projects/${launch}`, { spaceId: team, folderId: broadway })

    expect((await ayush.call('DELETE', `/api/folders/${broadway}`)).status).toBe(409)
    expect((await outsider.call('DELETE', `/api/projects/${launch}`)).status).toBe(404)
  })
})

describe('libraries', () => {
  let render = ''
  let item = ''

  it('keeps notes and tagged pictures on a space and its folders', async () => {
    const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#c08040' } }).png().toBuffer()
    render = createHash('sha256').update(png).digest('hex')
    await fetch(`${base}/api/media/${render}`, { method: 'PUT', headers: { cookie: ayush.cookie, origin, 'content-type': 'image/png' }, body: png })

    await ayush.call('PATCH', `/api/spaces/${team}`, { about: 'Brand: ASBL. Tone: warm, confident. End every ad on the logo.' })
    await teammate.call('PATCH', `/api/folders/${broadway}`, { about: 'ASBL Broadway, Hyderabad. 3 and 4 BHK. RERA No. P02400001234 must appear on the end card.' })
    const added = await teammate.call('POST', '/api/library', {
      spaceId: team,
      folderId: broadway,
      hash: render,
      name: 'Clubhouse dusk.png',
      mime: 'image/png',
      width: 1600,
      height: 900,
      tags: ['Clubhouse', ' dusk ', 'clubhouse', '#Aerial'],
    })
    expect(added.status).toBe(201)
    item = added.json.item.id
    expect(added.json.item.tags).toEqual(['clubhouse', 'dusk', 'aerial'])
    // The same file in the same place stays one item.
    expect((await ayush.call('POST', '/api/library', { spaceId: team, folderId: broadway, hash: render, name: 'again', mime: 'image/png' })).json.item.id).toBe(item)
    expect((await outsider.call('POST', '/api/library', { spaceId: team, folderId: broadway, hash: render, name: 'x', mime: 'image/png' })).status).toBe(404)

    const levels = (await ayush.call('GET', `/api/projects/${launch}/library`)).json.levels
    expect(levels.map((l: Json) => [l.name, l.items.length])).toEqual([
      ['ASBL Ads', 0],
      ['Broadway', 1],
    ])
    expect(levels[1].about).toContain('RERA')
    expect((await ayush.call('GET', `/api/spaces/${team}/contents`)).json.libraryCounts).toEqual({ [broadway]: 1 })
  })

  it("is what Claude reads for a project in that folder, and nothing outside it", async () => {
    const listed = await teammate.claude('list_projects', {})
    expect(listed.text).toContain('- ASBL Ads (team of 2 people)')
    expect(listed.text).toContain('  - Broadway · 1 project · library: 1 item')
    expect(listed.text).toContain('"Broadway launch 30s"')
    expect(listed.text).toContain('in ASBL Ads › Broadway')

    const overview = await teammate.claude('get_project', { project: launch })
    expect(overview.text).toContain('Lives in: ASBL Ads › Broadway')
    const library = await teammate.claude('get_library', { project: launch })
    expect(library.text).toContain('End every ad on the logo')
    expect(library.text).toContain('RERA No. P02400001234')
    expect(library.text).toContain(`"Clubhouse dusk.png" · id ${item} · tags: clubhouse, dusk, aerial`)

    expect((await teammate.claude('search_library', { project: launch, query: 'dusk', tags: ['clubhouse'] })).text).toContain(`id ${item}`)
    expect((await teammate.claude('search_library', { project: launch, query: 'pool' })).text).toContain('Nothing matches')

    // Ayush's short film is in his own space: no library from the team.
    const film = await ayush.claude('get_library', { project: 'Short film draft' })
    expect(film.text).not.toContain('Broadway')
    // And someone outside the team can't reach the project at all.
    expect((await outsider.claude('get_library', { project: launch })).isError).toBe(true)
  })

  it("lets Claude use a library picture, add to a library, and suggest tags that people keep or drop", async () => {
    expect((await teammate.claude('view_pictures', { project: launch, of: 'library', items: [item] })).text).toContain('Clubhouse dusk.png')
    const attached = await teammate.claude('attach_media', { project: launch, to: 'frame_picture', frame: '1', library_item: item })
    expect(attached.isError).toBeFalsy()
    expect((await teammate.claude('get_cut', { project: launch })).text).toContain('Picture: image')

    const made = await ayush.claude('create_project', { title: 'Festive 15s', type: 'ad', folder: 'asbl ads/broadway/festive' })
    expect(made.text).toContain('in ASBL Ads › Broadway › Festive')

    const suggested = await teammate.claude('suggest_tags', { items: [{ item, tags: ['pool', 'Dusk', 'night'] }] })
    expect(suggested.text).toContain('"Clubhouse dusk.png": pool, night')
    const kept = await ayush.call('PATCH', `/api/library/${item}`, { accept: ['pool'], reject: ['night'] })
    expect(kept.json.item).toMatchObject({ tags: ['clubhouse', 'dusk', 'aerial', 'pool'], suggestedTags: [] })

    const plan = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const planHash = createHash('sha256').update(plan).digest('hex')
    await fetch(`${base}/api/media/${planHash}`, { method: 'PUT', headers: { cookie: ayush.cookie, origin, 'content-type': 'image/png' }, body: plan })
    const added = await ayush.claude('add_to_library', { project: launch, hash: planHash, name: 'Floor plan 3BHK.png', tags: ['floor plan'] })
    expect(added.text).toContain('Added to the library of ASBL Ads › Broadway')
    expect(added.text).toContain('suggested tags waiting for a person: floor plan')
  })
})
