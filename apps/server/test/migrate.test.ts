import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// A database from before spaces: people and projects, nothing else.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-migrate-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
const old = new Database(path.join(dataDir, 'weft.db'))
old.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar_url TEXT, provider TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
  INSERT INTO users VALUES ('user0000000a', 'ayush@example.com', 'Ayush', NULL, 'dev', 1), ('user0000000b', 'priya@example.com', 'Priya', NULL, 'dev', 2);
  INSERT INTO projects VALUES ('proj0000000a', 'Skyline 30s', 'ad', 'user0000000a', 1, 5, NULL), ('proj0000000b', 'Write test', 'ad', 'user0000000b', 2, 6, NULL);
`)
old.close()

const { db } = await import('../src/db')
const { listProjects } = await import('../src/projects')
const { listSpaces } = await import('../src/spaces')

afterAll(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('moving to spaces', () => {
  it('puts the projects there were into one team space with everyone, so nobody loses any', () => {
    for (const user of ['user0000000a', 'user0000000b']) {
      const team = listSpaces(user).filter((s) => s.kind === 'team')
      expect(team).toMatchObject([{ name: 'Team', role: 'owner', members: 2, projects: 2 }])
      expect(listProjects(user).map((p) => [p.title, p.spaceId, p.folderId])).toEqual([
        ['Write test', team[0]!.id, null],
        ['Skyline 30s', team[0]!.id, null],
      ])
    }
  })
})
