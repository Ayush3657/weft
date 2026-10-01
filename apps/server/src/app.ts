import { serveStatic } from '@hono/node-server/serve-static'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'
import {
  SESSION_COOKIE,
  createAccessToken,
  createSession,
  deleteAccessToken,
  deleteSession,
  isEmailAllowed,
  listAccessTokens,
  upsertUser,
  userFromAccessToken,
  userFromRequest,
  type PublicUser,
} from './auth'
import { liveChangeSets, sessionWithChangeSet } from './agent/session'
import { createAgentServer } from './agent/tools'
import { config, isOriginAllowed } from './config'
import { log } from './log'
import { HASH_PATTERN, UploadError, getMedia, mediaResponse, storeMedia } from './media'
import { PREVIEW_SIZES, mediaPreview, type PreviewSize } from './previews'
import { createProject, docName, getProject, listProjects, softDeleteProject } from './projects'
import { hocuspocus } from './sync'
import { UnfurlError, unfurl } from './unfurl'

type Env = { Variables: { user: PublicUser | null } }

export const app = new Hono<Env>()

app.onError((err, c) => {
  if (err instanceof UploadError) return c.json({ error: err.message }, err.status)
  if (err instanceof UnfurlError) return c.json({ error: err.message }, err.status)
  log.error(`${c.req.method} ${c.req.path} failed`, err)
  return c.json({ error: 'Something went wrong on the server' }, 500)
})

app.use('/api/*', async (c, next) => {
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    // Browsers send Origin on cross-site requests; tools using access tokens don't send one.
    const origin = c.req.header('origin')
    if (origin && !isOriginAllowed(origin)) return c.json({ error: 'Origin not allowed' }, 403)
  }
  c.set('user', userFromRequest(c.req.raw.headers))
  await next()
})

const requireUser = createMiddleware<Env>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Sign in to continue' }, 401)
  await next()
})

const currentUser = (c: Context<Env>): PublicUser => c.get('user')!

async function body<T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined))
  return parsed.success ? parsed.data : null
}

// ------------------------------------------------------------------ auth

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/auth/config', (c) => c.json({ devLogin: config.devLogin, providers: [] as string[] }))

app.get('/api/me', (c) => {
  const user = c.get('user')
  return user ? c.json({ user }) : c.json({ user: null }, 401)
})

const DevLoginBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200),
})

app.post('/api/auth/dev', async (c) => {
  if (!config.devLogin) return c.json({ error: 'Dev sign-in is turned off' }, 404)
  const input = await body(c, DevLoginBody)
  if (!input) return c.json({ error: 'Enter your name and a valid email' }, 400)
  if (!isEmailAllowed(input.email)) return c.json({ error: "That email isn't allowed on this server" }, 403)
  const user = upsertUser({ ...input, provider: 'dev' })
  const { token, maxAge } = createSession(user.id)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    maxAge,
  })
  log.info(`${user.email} signed in (dev)`)
  return c.json({ user })
})

app.post('/api/auth/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) deleteSession(token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

// -------------------------------------------------------------- projects

app.get('/api/projects', requireUser, (c) => c.json({ projects: listProjects() }))

const CreateProjectBody = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['ad', 'film', 'other']),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '2.39:1']).optional(),
  targetDuration: z.number().positive().max(36000).nullable().optional(),
})

app.post('/api/projects', requireUser, async (c) => {
  const input = await body(c, CreateProjectBody)
  if (!input) return c.json({ error: 'Give the project a title and type' }, 400)
  const project = createProject(currentUser(c).id, {
    title: input.title,
    type: input.type,
    ...(input.aspect ? { aspect: input.aspect } : {}),
    ...(input.targetDuration !== undefined ? { targetDuration: input.targetDuration } : {}),
  })
  log.info(`${currentUser(c).email} created project "${project.title}"`)
  return c.json({ project }, 201)
})

app.delete('/api/projects/:id', requireUser, (c) => {
  const id = c.req.param('id')
  if (!getProject(id) || !softDeleteProject(id)) return c.json({ error: 'Project not found' }, 404)
  hocuspocus.closeConnections(docName(id))
  log.info(`${currentUser(c).email} deleted project ${id}`)
  return c.json({ ok: true })
})

// ----------------------------------------------------------------- media

const UPLOAD_TYPES = /^(image|video|audio)\/[a-z0-9.+-]+$/

app.get('/api/media/:hash/exists', requireUser, (c) => c.json({ exists: getMedia(c.req.param('hash')) !== null }))

app.put('/api/media/:hash', requireUser, async (c) => {
  const hash = c.req.param('hash')
  if (!HASH_PATTERN.test(hash)) return c.json({ error: 'Invalid file hash' }, 400)
  const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!UPLOAD_TYPES.test(mime)) return c.json({ error: 'Only images, video and audio can be uploaded' }, 415)
  const stream = c.req.raw.body
  if (!stream) return c.json({ error: 'The upload was empty' }, 400)
  const row = await storeMedia(stream, hash, mime, currentUser(c).id)
  return c.json({ hash: row.hash, size: row.size, mime: row.mime })
})

/**
 * A small copy of a picture for showing it at a size: cards and thumbnails
 * load a few kilobytes instead of the full file. Anything that can't be
 * resized (video, animated GIFs) gets the original instead.
 */
app.get('/api/media/:hash/preview/:size', requireUser, async (c) => {
  const hash = c.req.param('hash')
  const size = Number(c.req.param('size'))
  if (!(PREVIEW_SIZES as readonly number[]).includes(size)) return c.json({ error: 'Unknown preview size' }, 400)
  const row = getMedia(hash)
  if (!row) return c.json({ error: 'File not found' }, 404)
  const file = await mediaPreview(hash, size as PreviewSize)
  if (!file) return c.redirect(`/api/media/${hash}`, 302)
  const etag = `"${hash}-${size}"`
  if (c.req.header('if-none-match') === etag) return c.body(null, 304)
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(statSync(file).size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

app.get('/api/media/:hash', requireUser, (c) => {
  const row = getMedia(c.req.param('hash'))
  if (!row) return c.json({ error: 'File not found' }, 404)
  if (c.req.header('if-none-match') === `"${row.hash}"`) return c.body(null, 304)
  const response = mediaResponse(row, c.req.header('range'))
  // Uploaded files must never run as pages on this origin (e.g. scripted SVGs).
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  return response
})

// --------------------------------------------------------- link previews

app.get('/api/unfurl', requireUser, async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'Add a link to preview' }, 400)
  return c.json({ preview: await unfurl(url) })
})

// ------------------------------------------------------------- Claude (MCP)

/**
 * The MCP endpoint Claude connects to (through the Weft connector, or
 * directly from Claude Code). Only access tokens work here, never the
 * session cookie, so web pages can't drive it.
 */
app.all('/mcp', async (c) => {
  const origin = c.req.header('origin')
  if (origin && !isOriginAllowed(origin)) return c.json({ error: 'Origin not allowed' }, 403)
  const auth = c.req.header('authorization')
  const user = auth?.startsWith('Bearer ') ? userFromAccessToken(auth.slice(7).trim()) : null
  if (!user) {
    const message = 'Connect with a Weft access token (Authorization: Bearer weft_…). Make one in Weft from your account menu: Connect Claude.'
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, 401)
  }
  if (c.req.method !== 'POST') {
    return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, 405, { Allow: 'POST' })
  }
  const call = (await c.req.raw
    .clone()
    .json()
    .catch(() => null)) as { method?: string; params?: { name?: string } } | null
  if (call?.method === 'tools/call') log.info(`${user.email} → ${call.params?.name ?? '?'} (Claude)`)
  // Stateless: a fresh server per request, so any number of Claude windows can connect.
  const server = createAgentServer(user)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(c.req.raw)
  } finally {
    void server.close()
  }
})

/** What the "Connect Claude" dialog needs to write Claude's settings. */
app.get('/api/connect', requireUser, (c) =>
  c.json({
    serverUrl: config.agentUrl,
    connectorPath: config.connectorPath,
    connectorBuilt: existsSync(config.connectorPath),
    // The Node that runs this server, so Claude Desktop doesn't depend on its PATH.
    nodePath: process.execPath,
  }),
)

/**
 * Which of Claude's change sets can still be undone. Undo lives in the
 * session's memory, so a server restart ends it.
 */
app.get('/api/projects/:id/changes/live', requireUser, async (c) => c.json({ live: await liveChangeSets(c.req.param('id')) }))

/** Undoes a change set Claude made, while its session is still running. */
app.post('/api/projects/:id/changes/:changeId/undo', requireUser, async (c) => {
  const { id, changeId } = c.req.param()
  const session = await sessionWithChangeSet(id, changeId)
  if (!session) {
    return c.json({ error: "These changes can't be undone from Weft any more, because Claude's session has ended. Ask Claude to change them back, or edit them by hand." }, 409)
  }
  const steps = session.undoChangeSet(changeId)
  log.info(`${currentUser(c).email} undid Claude's change set ${changeId} (${steps} steps)`)
  return c.json({ ok: true, steps })
})

// --------------------------------------------------------- access tokens

const CreateTokenBody = z.object({ name: z.string().trim().min(1).max(80) })

app.get('/api/tokens', requireUser, (c) => c.json({ tokens: listAccessTokens(currentUser(c).id) }))

app.post('/api/tokens', requireUser, async (c) => {
  const input = await body(c, CreateTokenBody)
  if (!input) return c.json({ error: 'Give the token a name' }, 400)
  const { id, token } = createAccessToken(currentUser(c).id, input.name)
  return c.json({ id, token }, 201)
})

app.delete('/api/tokens/:id', requireUser, (c) => {
  deleteAccessToken(currentUser(c).id, c.req.param('id'))
  return c.json({ ok: true })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// ------------------------------------------------- built web app (production)

if (existsSync(config.webDist)) {
  const root = path.relative(process.cwd(), config.webDist) || '.'
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ path: path.join(root, 'index.html') }))
}
