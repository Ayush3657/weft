import { newId } from '@weft/model'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { log } from './log'

mkdirSync(config.dataDir, { recursive: true })

/** How the server exits when another Weft has its data folder open (the desktop app looks for it). */
export const DATA_IN_USE = 3

export const db = new Database(path.join(config.dataDir, 'weft.db'))
// One Weft at a time on a data folder: two would overwrite each other's work.
// This server holds the database for as long as it runs, and lets go when it stops, however it stops.
// (It waits a moment first, for a copy that's just stopping, as when the dev server restarts.)
db.pragma('busy_timeout = 3000')
db.pragma('locking_mode = EXCLUSIVE')
try {
  db.pragma('journal_mode = WAL')
  db.exec('BEGIN EXCLUSIVE; COMMIT')
} catch (error) {
  if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error
  log.error(`Another copy of Weft is using the data folder ${config.dataDir}. Close it first, or give this one a different folder.`)
  process.exit(DATA_IN_USE)
}
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    provider TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS project_docs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    state BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    hash TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL
  );

  -- A space holds projects in folders, and only its members see it: your
  -- personal space, or a team's.
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'team')),
    about TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS space_members (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    added_at INTEGER NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );

  -- People added by email before they've signed in; they join when they do.
  CREATE TABLE IF NOT EXISTS space_invites (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    invited_at INTEGER NOT NULL,
    PRIMARY KEY (space_id, email)
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    about TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS folders_by_space ON folders(space_id);

  -- Pictures, clips and sound kept in a space's or folder's library, for every project inside to use.
  CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration REAL,
    caption TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    suggested_tags TEXT NOT NULL DEFAULT '[]',
    added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS library_items_by_place ON library_items(space_id, folder_id);
`)

// Projects belong to a space, and maybe a folder in it.
const projectColumns = new Set((db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((c) => c.name))
if (!projectColumns.has('space_id')) db.exec('ALTER TABLE projects ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE')
if (!projectColumns.has('folder_id')) db.exec('ALTER TABLE projects ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL')
db.exec('CREATE INDEX IF NOT EXISTS projects_by_space ON projects(space_id)')

// Projects from before spaces go into one team space with everyone who has
// signed in so far, so they stay where everyone can see them.
const unplaced = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE space_id IS NULL').get() as { n: number }).n
if (unplaced) {
  db.transaction(() => {
    const now = Date.now()
    const users = db.prepare('SELECT id FROM users ORDER BY created_at').all() as Array<{ id: string }>
    const id = newId()
    db.prepare("INSERT INTO spaces (id, name, kind, created_by, created_at, updated_at) VALUES (?, 'Team', 'team', ?, ?, ?)").run(
      id,
      users[0]?.id ?? null,
      now,
      now,
    )
    for (const user of users) db.prepare("INSERT INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, user.id, now)
    db.prepare('UPDATE projects SET space_id = ? WHERE space_id IS NULL').run(id)
  })()
}

export interface UserRow {
  id: string
  email: string
  name: string
  avatar_url: string | null
  provider: string
  created_at: number
}

export interface ProjectRow {
  id: string
  title: string
  type: string
  created_by: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  space_id: string
  folder_id: string | null
}

export interface SpaceRow {
  id: string
  name: string
  kind: 'personal' | 'team'
  about: string
  created_by: string | null
  created_at: number
  updated_at: number
}

export interface FolderRow {
  id: string
  space_id: string
  parent_id: string | null
  name: string
  about: string
  created_by: string | null
  created_at: number
  updated_at: number
}

export interface LibraryItemRow {
  id: string
  space_id: string
  folder_id: string | null
  hash: string
  kind: 'image' | 'video' | 'audio'
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  caption: string
  tags: string
  suggested_tags: string
  added_by: string | null
  added_at: number
}

export interface MediaRow {
  hash: string
  mime: string
  size: number
  created_at: number
  created_by: string | null
}
