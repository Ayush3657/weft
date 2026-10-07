import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(serverRoot, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const env = process.env

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

const flag = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())

const production = env.NODE_ENV === 'production'
// Dev tools often set PORT for the web dev server, so in development only WEFT_PORT counts.
// Hosting platforms set PORT for the app, so production honours it.
const port = Number(env.WEFT_PORT || (production ? env.PORT : undefined) || 8787)
const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '')
const host = env.HOST ?? '127.0.0.1'

/** This computer's address on the local network, skipping virtual adapters (WSL, VMs, VPNs). */
function lanAddress(): string | null {
  const found: string[] = []
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier/i.test(name)) continue
    for (const a of addresses ?? []) if (a.family === 'IPv4' && !a.internal) found.push(a.address)
  }
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

const onlyHere = ['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase())
/** Where teammates reach this server: PUBLIC_URL if it's set to a shared address, else this computer's network address. */
const teamUrl = onlyHere
  ? null
  : env.PUBLIC_URL && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(env.PUBLIC_URL)
    ? publicUrl
    : (() => {
        const address = host === '0.0.0.0' || host === '::' ? lanAddress() : host
        return address ? `http://${address}:${port}` : null
      })()
// `npm run app` serves the built app from this server, rather than the web dev server doing it.
const appMode = env.npm_lifecycle_event === 'start'

export const config = {
  production,
  port,
  /** 127.0.0.1 keeps the server private to this PC; 0.0.0.0 opens it to the local network. */
  host,
  /** The address teammates (and their Claude) use, when the server is open to the network; null when it's private to this PC. */
  teamUrl,
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  dataDir: path.resolve(serverRoot, env.DATA_DIR ?? 'data'),
  /** The built web app, served from here when it's there. The desktop app brings its own. */
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(serverRoot, '../web/dist'),
  /** Sign in with just a name and email. For local testing only. */
  devLogin: flag(env.DEV_LOGIN, !production),
  allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS),
  allowedEmails: list(env.ALLOWED_EMAILS),
  /** Browser origins allowed to call the API and open sync connections. */
  allowedOrigins: new Set([
    publicUrl.toLowerCase(),
    ...list(env.ALLOWED_ORIGINS),
    // This computer, however it's reached, and teammates on the network.
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(teamUrl ? [teamUrl.toLowerCase()] : []),
    ...(production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024,
  /** Where people open the app: the web dev server in development. */
  appUrl: (env.APP_URL ?? (production ? publicUrl : appMode ? (teamUrl ?? `http://localhost:${port}`) : 'http://localhost:5173')).replace(/\/+$/, ''),
  /** Where Claude's MCP connector reaches this server (the API itself, not the web dev server). */
  agentUrl: (env.WEFT_AGENT_URL ?? (production ? publicUrl : `http://127.0.0.1:${port}`)).replace(/\/+$/, ''),
  /** The connector Claude Desktop runs; built with `npm run build -w @weft/mcp` (the desktop app brings its own). */
  connectorPath: env.WEFT_CONNECTOR ? path.resolve(env.WEFT_CONNECTOR) : path.resolve(serverRoot, '../mcp/dist/weft-mcp.mjs'),
  /**
   * In the desktop app, the Node that runs this server is the app itself,
   * which acts as Node for the connector only when told to.
   */
  connectorEnv: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : null,
  sessionDays: 30,
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  return !!origin && config.allowedOrigins.has(origin.toLowerCase())
}
