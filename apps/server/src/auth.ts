import { newId } from '@weft/model'
import { createHash, randomBytes } from 'node:crypto'
import { config } from './config'
import { db, type UserRow } from './db'

export const SESSION_COOKIE = 'weft_session'

export interface PublicUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

const toPublic = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  avatarUrl: row.avatar_url,
})

/** Tokens are stored hashed, so a copied database can't be used to sign in. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')

export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  if (!config.allowedDomains.length && !config.allowedEmails.length) return true
  if (config.allowedEmails.includes(normalized)) return true
  const domain = normalized.split('@')[1] ?? ''
  return config.allowedDomains.includes(domain)
}

export function upsertUser(input: { email: string; name: string; provider: string; avatarUrl?: string | null }): PublicUser {
  const email = input.email.trim().toLowerCase()
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  if (existing) {
    db.prepare('UPDATE users SET name = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?').run(
      input.name.trim() || existing.name,
      input.avatarUrl ?? null,
      existing.id,
    )
    return toPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow)
  }
  const row: UserRow = {
    id: newId(),
    email,
    name: input.name.trim() || email.split('@')[0] || email,
    avatar_url: input.avatarUrl ?? null,
    provider: input.provider,
    created_at: Date.now(),
  }
  db.prepare(
    'INSERT INTO users (id, email, name, avatar_url, provider, created_at) VALUES (@id, @email, @name, @avatar_url, @provider, @created_at)',
  ).run(row)
  return toPublic(row)
}

export function getUser(id: string): PublicUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? toPublic(row) : null
}

export function createSession(userId: string): { token: string; maxAge: number } {
  const token = newToken()
  const maxAge = config.sessionDays * 24 * 60 * 60
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    now + maxAge * 1000,
  )
  return { token, maxAge }
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function userFromSession(token: string | undefined): PublicUser | null {
  if (!token) return null
  const row = db
    .prepare(
      'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
    )
    .get(hashToken(token), Date.now()) as UserRow | undefined
  return row ? toPublic(row) : null
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function userFromHeaders(headers: Headers): PublicUser | null {
  return userFromSession(parseCookies(headers.get('cookie'))[SESSION_COOKIE])
}

/** Personal access tokens let tools like the Weft MCP server act as a user. */
export function createAccessToken(userId: string, name: string): { id: string; token: string } {
  const id = newId()
  const token = `weft_${newToken()}`
  db.prepare('INSERT INTO access_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    userId,
    name,
    hashToken(token),
    Date.now(),
  )
  return { id, token }
}

export function userFromAccessToken(token: string | undefined): PublicUser | null {
  if (!token?.startsWith('weft_')) return null
  const hash = hashToken(token)
  const row = db
    .prepare('SELECT users.* FROM access_tokens JOIN users ON users.id = access_tokens.user_id WHERE token_hash = ?')
    .get(hash) as UserRow | undefined
  if (!row) return null
  db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE token_hash = ?').run(Date.now(), hash)
  return toPublic(row)
}

/** Whose key this is, without counting it as used. */
export function accessTokenOwner(token: string): string | null {
  if (!token.startsWith('weft_')) return null
  const row = db.prepare('SELECT user_id FROM access_tokens WHERE token_hash = ?').get(hashToken(token)) as { user_id: string } | undefined
  return row?.user_id ?? null
}

export function listAccessTokens(userId: string): Array<{ id: string; name: string; createdAt: number; lastUsedAt: number | null }> {
  return (
    db
      .prepare('SELECT id, name, created_at, last_used_at FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{ id: string; name: string; created_at: number; last_used_at: number | null }>
  ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }))
}

export function deleteAccessToken(userId: string, id: string): void {
  db.prepare('DELETE FROM access_tokens WHERE id = ? AND user_id = ?').run(id, userId)
}

/** Resolves the caller from a Bearer access token or the session cookie. */
export function userFromRequest(headers: Headers): PublicUser | null {
  const auth = headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return userFromAccessToken(auth.slice(7).trim())
  return userFromHeaders(headers)
}
