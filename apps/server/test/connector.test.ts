import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-connector-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')

const connectorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mcp')
const connector = path.join(connectorDir, 'dist/weft-mcp.mjs')

type Running = Awaited<ReturnType<typeof startServer>>
type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

let server: Running
let base = ''
let token = ''
let projectId = ''
let client: Client

beforeAll(async () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: connectorDir })
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  const origin = 'http://localhost:5173'
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Ayush', email: 'ayush@example.com' }),
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const post = (pathname: string, body: unknown) =>
    fetch(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body) }).then(
      (r) => r.json() as Promise<Record<string, unknown>>,
    )
  projectId = ((await post('/api/projects', { title: 'Render test', type: 'film' })).project as { id: string }).id
  token = (await post('/api/tokens', { name: 'Claude Desktop' })).token as string

  // Started the way Claude Desktop starts it: node, the file, and two settings.
  client = new Client({ name: 'claude-desktop-test', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [connector], env: { WEFT_URL: base, WEFT_TOKEN: token, WEFT_CONNECTOR_FILE: path.join(dataDir, 'first', 'connector.json') }, stderr: 'pipe' }),
  )
})

afterAll(async () => {
  await client?.close()
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n')

describe('the Weft connector', () => {
  it('passes Claude through to the server', async () => {
    const info = client.getServerVersion()
    expect(info?.name).toBe('weft')
    expect(client.getInstructions()).toContain('Weft is a storyboarding app')
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(20)
    expect(textOf(await call('list_projects', {}))).toContain('Render test')
  })

  it('uploads a file from this computer when Claude attaches it by path', async () => {
    const render = path.join(dataDir, 'shot_010.png')
    writeFileSync(render, await sharp({ create: { width: 320, height: 180, channels: 3, background: '#335577' } }).png().toBuffer())
    const attached = await call('attach_media', { project: projectId, to: 'frame_picture', frame: '1', path: render })
    expect(attached.isError).toBeFalsy()
    expect(textOf(attached)).toContain('Attached shot_010.png (image)')
    const cut = textOf(await call('get_cut', { project: projectId }))
    expect(cut).toContain('Picture: image')
  })

  it('works before Weft is connected, and picks up the key without restarting', async () => {
    const keyFile = path.join(dataDir, 'home', '.weft', 'connector.json')
    const later = new Client({ name: 'claude-desktop-test', version: '1.0.0' })
    await later.connect(
      new StdioClientTransport({ command: process.execPath, args: [connector], env: { WEFT_URL: base, WEFT_CONNECTOR_FILE: keyFile }, stderr: 'pipe' }),
    )
    // Claude Desktop starts the connector at launch; Weft's tools show up even with no key yet.
    expect((await later.listTools()).tools.length).toBeGreaterThan(20)
    const before = (await later.callTool({ name: 'list_projects', arguments: {} })) as ToolResult
    expect(before.isError).toBe(true)
    expect(textOf(before)).toContain('Connect Claude on this computer')

    // Then someone clicks Connect Claude on this computer in Weft.
    mkdirSync(path.dirname(keyFile), { recursive: true })
    writeFileSync(keyFile, JSON.stringify({ url: base, token }))
    const after = (await later.callTool({ name: 'list_projects', arguments: {} })) as ToolResult
    expect(after.isError).toBeFalsy()
    expect(textOf(after)).toContain('Render test')
    await later.close()
  })

  it('says clearly when the file is missing', async () => {
    const missing = await call('attach_media', { project: projectId, to: 'frame_picture', frame: '1', path: path.join(dataDir, 'nope.png') })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain("There's no file at")
  })

  it('starts even when Weft is not running yet, and picks it up once it is', async () => {
    const free = await new Promise<number>((done) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number }
        probe.close(() => done(port))
      })
    })
    const url = `http://127.0.0.1:${free}`
    // Claude opened before Weft: the connector still starts, with the tools it saw last time.
    const early = new Client({ name: 'claude-desktop-test', version: '1.0.0' })
    let told: () => void = () => {}
    const backAgain = new Promise<void>((done) => (told = done))
    early.setNotificationHandler(ToolListChangedNotificationSchema, () => told())
    await early.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [connector],
        env: { WEFT_URL: url, WEFT_TOKEN: token, WEFT_CONNECTOR_FILE: path.join(dataDir, 'first', 'connector.json') },
        stderr: 'pipe',
      }),
    )
    expect(early.getServerVersion()?.name).toBe('weft')
    expect((await early.listTools()).tools.length).toBeGreaterThan(20)
    const down = (await early.callTool({ name: 'list_projects', arguments: {} })) as ToolResult
    expect(down.isError).toBe(true)
    expect(textOf(down)).toContain('Start Weft.cmd')

    // Then Weft starts: Claude is told to look again, and calls go through.
    const second = await startServer({ port: free, host: '127.0.0.1' })
    await backAgain
    const up = (await early.callTool({ name: 'list_projects', arguments: {} })) as ToolResult
    expect(up.isError).toBeFalsy()
    expect(textOf(up)).toContain('Render test')
    await early.close()
    await second.close()
  }, 20000)
})
