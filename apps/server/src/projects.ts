import { PROJECT_TYPES, initProject, newId, readMeta, type AspectRatio, type ProjectType } from '@weft/model'
import * as Y from 'yjs'
import { db, type ProjectRow } from './db'

const DOC_PREFIX = 'project/'

export const docName = (projectId: string) => `${DOC_PREFIX}${projectId}`

export function projectIdFromDocName(name: string): string | null {
  if (!name.startsWith(DOC_PREFIX)) return null
  const id = name.slice(DOC_PREFIX.length)
  return /^[A-Za-z0-9]{6,32}$/.test(id) ? id : null
}

export interface ProjectSummary {
  id: string
  title: string
  type: string
  createdAt: number
  updatedAt: number
  createdBy: { id: string; name: string } | null
}

const toSummary = (row: ProjectRow & { creator_name: string | null }): ProjectSummary => ({
  id: row.id,
  title: row.title,
  type: row.type,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  createdBy: row.created_by ? { id: row.created_by, name: row.creator_name ?? '' } : null,
})

export function listProjects(): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT projects.*, users.name AS creator_name FROM projects
       LEFT JOIN users ON users.id = projects.created_by
       WHERE projects.deleted_at IS NULL ORDER BY projects.updated_at DESC`,
    )
    .all() as Array<ProjectRow & { creator_name: string | null }>
  return rows.map(toSummary)
}

export function getProject(id: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined) ?? null
}

export interface CreateProjectInput {
  title: string
  type: ProjectType
  aspect?: AspectRatio
  targetDuration?: number | null
}

/** Creates a project and its initial document. Only the server ever initializes documents. */
export function createProject(userId: string, input: CreateProjectInput): ProjectSummary {
  const id = newId()
  const doc = new Y.Doc()
  initProject(doc, {
    title: input.title,
    type: input.type,
    ...(input.aspect ? { aspect: input.aspect } : {}),
    ...(input.targetDuration !== undefined ? { targetDuration: input.targetDuration } : {}),
  })
  const state = Buffer.from(Y.encodeStateAsUpdate(doc))
  doc.destroy()
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO projects (id, title, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, input.title, input.type, userId, now, now)
    db.prepare('INSERT INTO project_docs (project_id, state, updated_at) VALUES (?, ?, ?)').run(id, state, now)
  })()
  const row = db
    .prepare(
      'SELECT projects.*, users.name AS creator_name FROM projects LEFT JOIN users ON users.id = projects.created_by WHERE projects.id = ?',
    )
    .get(id) as ProjectRow & { creator_name: string | null }
  return toSummary(row)
}

function summaryOf(id: string): ProjectSummary {
  const row = db
    .prepare(
      'SELECT projects.*, users.name AS creator_name FROM projects LEFT JOIN users ON users.id = projects.created_by WHERE projects.id = ?',
    )
    .get(id) as ProjectRow & { creator_name: string | null }
  return toSummary(row)
}

export class ImportError extends Error {}

/**
 * Adds a project from its saved sync state (a project folder opened in Weft).
 * It keeps its id when that's free, so the same project stays the same project
 * wherever it's opened. If this server already has it, nothing changes and the
 * app merges the folder's copy in instead.
 */
export function importProject(userId: string, state: Uint8Array, wantedId: string | null): { project: ProjectSummary; existed: boolean } {
  const validId = wantedId && /^[A-Za-z0-9]{6,32}$/.test(wantedId) ? wantedId : null
  const existing = validId ? getProject(validId) : null
  if (existing && !existing.deleted_at) return { project: summaryOf(existing.id), existed: true }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
  } catch {
    throw new ImportError("That file isn't a Weft project")
  }
  const meta = readMeta(doc.getMap('meta'))
  const isProject = !!meta.mainCutId && doc.getMap('cuts').has(meta.mainCutId)
  doc.destroy()
  if (!isProject) throw new ImportError("That file isn't a Weft project")

  const id = validId && !existing ? validId : newId()
  const type: ProjectType = (PROJECT_TYPES as readonly string[]).includes(meta.type) ? meta.type : 'other'
  const now = Date.now()
  db.transaction(() => {
    db.prepare('INSERT INTO projects (id, title, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      meta.title || 'Untitled',
      type,
      userId,
      now,
      now,
    )
    db.prepare('INSERT INTO project_docs (project_id, state, updated_at) VALUES (?, ?, ?)').run(id, Buffer.from(state), now)
  })()
  return { project: summaryOf(id), existed: false }
}

export function softDeleteProject(id: string): boolean {
  return db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(Date.now(), id).changes > 0
}

export function loadProjectState(id: string): Uint8Array | null {
  const row = db.prepare('SELECT state FROM project_docs WHERE project_id = ?').get(id) as { state: Buffer } | undefined
  return row ? new Uint8Array(row.state) : null
}

export function saveProjectState(id: string, state: Uint8Array, meta: { title: string; type: string }): void {
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO project_docs (project_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at',
    ).run(id, Buffer.from(state), now)
    db.prepare('UPDATE projects SET title = COALESCE(NULLIF(?, \'\'), title), type = ?, updated_at = ? WHERE id = ?').run(
      meta.title,
      meta.type,
      now,
      id,
    )
  })()
}
