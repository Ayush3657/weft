import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-connect-test-'))
const keyFile = path.join(dataDir, 'home', '.weft', 'connector.json')
const desktopConfig = path.join(dataDir, 'Claude', 'claude_desktop_config.json')
process.env.DATA_DIR = path.join(dataDir, 'data')
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.PUBLIC_URL = 'http://localhost:5173'
process.env.WEFT_CONNECTOR_FILE = keyFile
process.env.CLAUDE_DESKTOP_CONFIG = desktopConfig

const { startServer } = await import('../src/server')
const { db } = await import('../src/db')
const { config } = await import('../src/config')

let server: Awaited<ReturnType<typeof startServer>>
let base = ''
let cookie = ''
const origin = 'http://localhost:5173'

const call = (method: string, pathname: string) =>
  fetch(`${base}${pathname}`, { method, headers: { cookie, origin } }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, any> }))

async function projectsWith(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  const result = (await client.callTool({ name: 'list_projects', arguments: {} })) as { isError?: boolean; content: Array<{ text?: string }> }
  await client.close()
  return result
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>

beforeAll(async () => {
  // Claude Desktop is installed, with another server and its own settings already there.
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.dirname(desktopConfig), { recursive: true })
  writeFileSync(desktopConfig, JSON.stringify({ preferences: { menuBarEnabled: true }, mcpServers: { blender: { command: 'blender-mcp' } } }, null, 2))
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
  const login = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Ayush', email: 'ayush@example.com' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
})

afterAll(async () => {
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('connecting Claude on this computer', () => {
  it('saves a key where the connector looks and adds Weft to Claude Desktop, keeping the rest', async () => {
    expect((await call('GET', '/api/connect')).json.here).toMatchObject({ available: true, connected: false, desktopFound: true, desktopHasWeft: false })

    const connected = await call('POST', '/api/connect/local')
    expect(connected.status).toBe(200)
    expect(connected.json).toMatchObject({ keyFile, desktopFound: true, desktop: { updated: [desktopConfig], failed: [] } })

    const settings = readJson(desktopConfig)
    expect(settings.preferences).toEqual({ menuBarEnabled: true })
    expect(settings.mcpServers.blender).toEqual({ command: 'blender-mcp' })
    expect(settings.mcpServers.weft).toEqual({ command: process.execPath, args: [config.connectorPath] })
    expect(existsSync(`${desktopConfig}.before-weft`)).toBe(true)

    const saved = readJson(keyFile)
    expect(saved.url).toBe(config.agentUrl)
    expect(saved.token).toMatch(/^weft_/)
    expect((await projectsWith(saved.token)).isError).toBeFalsy()
    expect((await call('GET', '/api/connect')).json.here).toMatchObject({ connected: true, desktopHasWeft: true })
  })

  it('replaces the key when connecting again, and disconnecting takes everything back out', async () => {
    const first = readJson(keyFile).token as string
    await call('POST', '/api/connect/local')
    const second = readJson(keyFile).token as string
    expect(second).not.toBe(first)
    expect((await projectsWith(first)).isError).toBe(true)
    const keys = (await call('GET', '/api/tokens')).json.tokens as Array<{ name: string }>
    expect(keys.filter((k) => k.name === 'Claude on this computer')).toHaveLength(1)

    const gone = await call('DELETE', '/api/connect/local')
    expect(gone.status).toBe(200)
    expect(existsSync(keyFile)).toBe(false)
    expect((await projectsWith(second)).isError).toBe(true)
    const settings = readJson(desktopConfig)
    expect(settings.mcpServers).toEqual({ blender: { command: 'blender-mcp' } })
    expect((await call('GET', '/api/connect')).json.here).toMatchObject({ connected: false, desktopHasWeft: false })
  })
})
