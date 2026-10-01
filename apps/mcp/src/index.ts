/**
 * The Weft connector: Claude Desktop starts this program and talks MCP to it
 * over stdin and stdout. It passes everything on to your Weft server, and
 * uploads files from this computer when Claude attaches one by its path
 * (a Blender render, say), since the server can't read your disk.
 *
 * It finds the server and its key in ~/.weft/connector.json, which Weft
 * writes when you choose Connect Claude on this computer. The file is read
 * on every request, so connecting (or reconnecting) needs no restart.
 * For another computer, set these instead:
 *   WEFT_URL    the Weft server, e.g. http://127.0.0.1:8787
 *   WEFT_TOKEN  an access token from Weft (your menu: Connect Claude)
 */
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// stdout carries the protocol, so anything for people goes to stderr (Claude Desktop keeps it in its logs).
const log = (...parts: unknown[]) => console.error('[weft]', ...parts)

const KEY_FILE = process.env.WEFT_CONNECTOR_FILE || path.join(os.homedir(), '.weft', 'connector.json')
const trimUrl = (url: string) => url.replace(/\/+$/, '')

/** The server and key: from the environment if set, otherwise from the file Weft saved. */
async function settings(): Promise<{ url: string; token: string | null }> {
  const envUrl = process.env.WEFT_URL ? trimUrl(process.env.WEFT_URL) : null
  const envToken = process.env.WEFT_TOKEN?.trim()
  if (envToken) return { url: envUrl ?? 'http://127.0.0.1:8787', token: envToken }
  try {
    const saved = JSON.parse(await readFile(KEY_FILE, 'utf8')) as { url?: unknown; token?: unknown }
    return {
      url: envUrl ?? (typeof saved.url === 'string' && saved.url ? trimUrl(saved.url) : 'http://127.0.0.1:8787'),
      token: typeof saved.token === 'string' && saved.token ? saved.token : null,
    }
  } catch {
    return { url: envUrl ?? 'http://127.0.0.1:8787', token: null }
  }
}

const start = await settings()
const serverUrl = start.url
if (!start.token) log(`No key yet. In Weft, open your account menu and choose Connect Claude. (Looked in ${KEY_FILE}.)`)

/** Requests to the server carry the current key, so a new one works without restarting Claude. */
async function withKey(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const { token } = await settings()
  const headers = new Headers(init?.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
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

const describe = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)
    ? `Can't reach Weft at ${serverUrl}. Make sure it's running (npm run dev in the Weft folder).`
    : message
}

const remote = new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`), { fetch: withKey })
const local = new StdioServerTransport()

async function forward(message: JSONRPCMessage): Promise<void> {
  const request = 'method' in message && 'id' in message ? message : null
  try {
    if (request?.method === 'tools/call') {
      const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined
      if (params?.name === 'attach_media' && typeof params.arguments?.path === 'string') {
        message = { ...request, params: { ...params, arguments: await uploadLocalFile(params.arguments) } }
      }
    }
    await remote.send(message)
  } catch (error) {
    if (!request) {
      log(describe(error))
      return
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
remote.onmessage = (message) => void local.send(message)
remote.onerror = (error) => log(describe(error))
local.onclose = () => void remote.close().finally(() => process.exit(0))

await remote.start()
await local.start()
log(`connected to ${serverUrl}`)
