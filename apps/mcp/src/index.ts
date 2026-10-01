/**
 * The Weft connector: Claude Desktop starts this program and talks MCP to it
 * over stdin and stdout. It passes everything on to your Weft server, and
 * uploads files from this computer when Claude attaches one by its path
 * (a Blender render, say), since the server can't read your disk.
 *
 * It finds the server and its key in ~/.weft/connector.json, which Weft
 * writes when you choose Connect Claude on this computer. The file is read
 * on every request, so connecting (or reconnecting) needs no restart.
 * On another computer, the "Weft for Claude" extension sets these instead
 * (from what you enter when installing it):
 *   WEFT_URL    the Weft server, e.g. http://10.0.0.5:8787
 *   WEFT_TOKEN  a key from Weft (your menu: Connect Claude)
 */
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// stdout carries the protocol, so anything for people goes to stderr (Claude Desktop keeps it in its logs).
const log = (...parts: unknown[]) => console.error('[weft]', ...parts)

const KEY_FILE = process.env.WEFT_CONNECTOR_FILE || path.join(os.homedir(), '.weft', 'connector.json')
const trimUrl = (url: string) => url.replace(/\/+$/, '')

/**
 * The server and key: from the environment if set (the extension's
 * settings, or a setup by hand), otherwise from the file Weft saved.
 */
async function settings(): Promise<{ url: string; token: string | null; from: 'settings' | 'file' }> {
  const envUrl = process.env.WEFT_URL?.trim() ? trimUrl(process.env.WEFT_URL.trim()) : null
  const envToken = process.env.WEFT_TOKEN?.trim()
  if (envToken) return { url: envUrl ?? 'http://127.0.0.1:8787', token: envToken, from: 'settings' }
  try {
    const saved = JSON.parse(await readFile(KEY_FILE, 'utf8')) as { url?: unknown; token?: unknown }
    return {
      url: envUrl ?? (typeof saved.url === 'string' && saved.url ? trimUrl(saved.url) : 'http://127.0.0.1:8787'),
      token: typeof saved.token === 'string' && saved.token ? saved.token : null,
      from: 'file',
    }
  } catch {
    return { url: envUrl ?? 'http://127.0.0.1:8787', token: null, from: 'file' }
  }
}

const start = await settings()
const serverUrl = start.url
/** Weft runs on this computer (rather than a teammate's). */
const weftIsHere = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(serverUrl)
if (!start.token) {
  log(
    start.from === 'settings'
      ? "No key yet. In Weft, create one (your account menu, Connect Claude, On another computer) and add it in Claude's settings for Weft."
      : `No key yet. In Weft, open your account menu and choose Connect Claude. (Looked in ${KEY_FILE}.)`,
  )
}

/** Requests to the server carry the current key, so a new one works without restarting Claude. */
async function withKey(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const { token, from } = await settings()
  const headers = new Headers(init?.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  // So the server's advice about keys fits how this Claude was set up.
  headers.set('x-weft-setup', from)
  return fetch(input, { ...init, headers })
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

/** attach_media with a local path: upload the file from here, then hand the server its hash instead. */
async function uploadLocalFile(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const given = String(args.path).trim().replace(/^["']|["']$/g, '')
  const full = path.resolve(given.startsWith('~') ? path.join(os.homedir(), given.slice(1)) : given)
  const type = MEDIA_TYPES[path.extname(full).toLowerCase()]
  if (!type) throw new Error(`${path.basename(full)} isn't a picture, video or sound file Weft can use.`)
  const info = await stat(full).catch(() => null)
  if (!info?.isFile()) throw new Error(`There's no file at ${full}.`)
  const data = await readFile(full)
  const hash = createHash('sha256').update(data).digest('hex')
  const res = await withKey(`${serverUrl}/api/media/${hash}`, { method: 'PUT', headers: { 'content-type': type }, body: data })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Uploading ${path.basename(full)} failed (${res.status}).`)
  }
  const { path: _uploaded, ...rest } = args
  return { ...rest, hash, name: typeof args.name === 'string' && args.name ? args.name : path.basename(full) }
}

const UNREACHABLE = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i
const unreachable = (error: unknown) => UNREACHABLE.test(error instanceof Error ? error.message : String(error))

const howToStart = weftIsHere
  ? 'Start it: double-click Start Weft.cmd in the Weft folder (or run npm run dev there)'
  : 'Check that Weft is running on the computer that hosts it (started with Start Weft for the team.cmd) and that this computer is on the same network'

const describe = (error: unknown) => (unreachable(error) ? `Can't reach Weft at ${serverUrl}. ${howToStart}, then try again.` : error instanceof Error ? error.message : String(error))

/**
 * What the server last said about itself and its tools, so Claude still sees
 * Weft when it starts before the server does. Tool calls then say to start
 * Weft, and Claude is told to look again once the server is back.
 */
const CACHE_FILE = path.join(path.dirname(KEY_FILE), 'claude-cache.json')
type Cache = { initialize?: Record<string, unknown>; 'tools/list'?: Record<string, unknown>; 'prompts/list'?: Record<string, unknown> }
const CACHED = new Set(['initialize', 'tools/list', 'prompts/list'])
let cache: Cache = await readFile(CACHE_FILE, 'utf8')
  .then((text) => JSON.parse(text) as Cache)
  .catch(() => ({}))

function remember(method: keyof Cache, result: Record<string, unknown>): void {
  cache = { ...cache, [method]: result }
  void mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => writeFile(CACHE_FILE, JSON.stringify(cache)))
    .catch((error) => log(`Couldn't save ${CACHE_FILE}:`, error))
}

function offlineResult(method: string, params: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (method === 'initialize') {
    const known = cache.initialize ?? { serverInfo: { name: 'weft', version: '0.1.0' } }
    return {
      ...known,
      protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : known.protocolVersion,
      capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } },
    }
  }
  if (method === 'tools/list') return cache['tools/list'] ?? { tools: [] }
  if (method === 'prompts/list') return cache['prompts/list'] ?? { prompts: [] }
  return null
}

/** While the server is down, checks for it every few seconds and tells Claude when it's back. */
let watching: ReturnType<typeof setInterval> | null = null
function waitForServer(): void {
  if (watching) return
  log(`Can't reach Weft at ${serverUrl} yet. ${howToStart}; Claude will pick it up.`)
  watching = setInterval(async () => {
    const up = await fetch(`${serverUrl}/api/health`).then((r) => r.ok, () => false)
    if (!up || !watching) return
    clearInterval(watching)
    watching = null
    log(`Weft is up at ${serverUrl}.`)
    await local.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    await local.send({ jsonrpc: '2.0', method: 'notifications/prompts/list_changed' })
  }, 3000)
}

const remote = new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`), { fetch: withKey })
const local = new StdioServerTransport()
/** Requests whose answers are worth keeping, by id. */
const pending = new Map<string | number, keyof Cache>()

async function forward(message: JSONRPCMessage): Promise<void> {
  const request = 'method' in message && 'id' in message ? message : null
  try {
    if (request && CACHED.has(request.method)) pending.set(request.id, request.method as keyof Cache)
    if (request?.method === 'tools/call') {
      const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined
      if (params?.name === 'attach_media' && typeof params.arguments?.path === 'string') {
        message = { ...request, params: { ...params, arguments: await uploadLocalFile(params.arguments) } }
      }
    }
    await remote.send(message)
  } catch (error) {
    if (!request) {
      if (!unreachable(error)) log(describe(error))
      return
    }
    pending.delete(request.id)
    if (unreachable(error)) {
      waitForServer()
      const offline = offlineResult(request.method, request.params as Record<string, unknown> | undefined)
      if (offline) {
        await local.send({ jsonrpc: '2.0', id: request.id, result: offline })
        return
      }
    }
    // Answer the request here so Claude sees what went wrong.
    await local.send(
      request.method === 'tools/call'
        ? { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: describe(error) }], isError: true } }
        : { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: describe(error) } },
    )
  }
}

local.onmessage = (message) => void forward(message)
remote.onmessage = (message) => {
  if ('result' in message && pending.has(message.id)) {
    remember(pending.get(message.id)!, message.result)
    pending.delete(message.id)
  }
  void local.send(message)
}
remote.onerror = (error) => {
  if (!unreachable(error)) log(describe(error))
}
local.onclose = () => void remote.close().finally(() => process.exit(0))

await remote.start()
await local.start()
log(`talking to ${serverUrl}`)
