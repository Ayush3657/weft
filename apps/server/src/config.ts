import { existsSync } from 'node:fs'
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

export const config = {
  production,
  port,
  /** 127.0.0.1 keeps the server private to this PC; 0.0.0.0 opens it to the local network. */
  host: env.HOST ?? '127.0.0.1',
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  dataDir: path.resolve(serverRoot, env.DATA_DIR ?? 'data'),
  webDist: path.resolve(serverRoot, '../web/dist'),
  /** Sign in with just a name and email. For local testing only. */
  devLogin: flag(env.DEV_LOGIN, !production),
  allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS),
  allowedEmails: list(env.ALLOWED_EMAILS),
  /** Browser origins allowed to call the API and open sync connections. */
  allowedOrigins: new Set([
    publicUrl.toLowerCase(),
    ...list(env.ALLOWED_ORIGINS),
    ...(production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024,
  /** Where people open the app: the web dev server in development. */
  appUrl: (env.APP_URL ?? (production ? publicUrl : 'http://localhost:5173')).replace(/\/+$/, ''),
  /** Where Claude's MCP connector reaches this server (the API itself, not the web dev server). */
  agentUrl: (env.WEFT_AGENT_URL ?? (production ? publicUrl : `http://127.0.0.1:${port}`)).replace(/\/+$/, ''),
  /** The connector Claude Desktop runs; built with `npm run build -w @weft/mcp`. */
  connectorPath: path.resolve(serverRoot, '../mcp/dist/weft-mcp.mjs'),
  sessionDays: 30,
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  return !!origin && config.allowedOrigins.has(origin.toLowerCase())
}
