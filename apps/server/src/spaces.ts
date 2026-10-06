import { newId } from '@weft/model'
import { db, type FolderRow, type ProjectRow, type SpaceRow } from './db'

/**
 * Spaces and folders. Every project lives in a space (your personal one, or
 * a team's) and maybe in a folder there; only a space's members see what's
 * in it. To anyone else, it doesn't exist.
 */

export class AccessError extends Error {
  readonly status: 400 | 403 | 404 | 409

  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message)
    this.status = status
  }
}

export type Role = 'owner' | 'member'

export interface SpaceSummary {
  id: string
  name: string
  kind: 'personal' | 'team'
  role: Role
  about: string
  members: number
  projects: number
}

export interface MemberInfo {
  id: string
  name: string
  email: string
  role: Role
}

export interface FolderInfo {
  id: string
  spaceId: string
  parentId: string | null
  name: string
  about: string
  createdAt: number
  updatedAt: number
}

const NAME_MAX = 80
export const ABOUT_MAX = 20_000

function cleanName(name: string, what: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim()
  if (!trimmed) throw new AccessError(`Give the ${what} a name`)
  if (trimmed.length > NAME_MAX) throw new AccessError(`Keep the ${what}'s name under ${NAME_MAX} characters`)
  return trimmed
}

// ----------------------------------------------------------------- spaces

export function roleIn(spaceId: string, userId: string): Role | null {
  const row = db.prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId) as { role: Role } | undefined
  return row?.role ?? null
}

/** The space, if this person is in it. */
export function spaceFor(spaceId: string, userId: string): SpaceRow & { role: Role } {
  const role = roleIn(spaceId, userId)
  const space = role ? (db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId) as SpaceRow | undefined) : undefined
  if (!space || !role) throw new AccessError('Space not found', 404)
  return { ...space, role }
}

function ownerOf(spaceId: string, userId: string): SpaceRow & { role: Role } {
  const space = spaceFor(spaceId, userId)
  if (space.role !== 'owner') throw new AccessError("Only the space's owners can do that", 403)
  return space
}

/** Everyone's own space, made the first time it's needed. */
export function personalSpace(userId: string): SpaceRow {
  const found = db
    .prepare("SELECT spaces.* FROM spaces JOIN space_members m ON m.space_id = spaces.id WHERE spaces.kind = 'personal' AND m.user_id = ?")
    .get(userId) as SpaceRow | undefined
  if (found) return found
  const id = newId()
  const now = Date.now()
  db.transaction(() => {
    db.prepare("INSERT INTO spaces (id, name, kind, created_by, created_at, updated_at) VALUES (?, 'Personal', 'personal', ?, ?, ?)").run(id, userId, now, now)
    db.prepare("INSERT INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, userId, now)
  })()
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as SpaceRow
}

/** The spaces this person is in: theirs first, then their teams by name. */
export function listSpaces(userId: string): SpaceSummary[] {
  personalSpace(userId)
  return db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.about, m.role,
         (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) AS members,
         (SELECT COUNT(*) FROM projects WHERE space_id = s.id AND deleted_at IS NULL) AS projects
       FROM spaces s JOIN space_members m ON m.space_id = s.id AND m.user_id = ?
       ORDER BY CASE s.kind WHEN 'personal' THEN 0 ELSE 1 END, s.name COLLATE NOCASE`,
    )
    .all(userId) as SpaceSummary[]
}

export function spaceSummary(spaceId: string, userId: string): SpaceSummary {
  const found = listSpaces(userId).find((s) => s.id === spaceId)
  if (!found) throw new AccessError('Space not found', 404)
  return found
}

export function createSpace(userId: string, name: string): SpaceSummary {
  const id = newId()
  const now = Date.now()
  db.transaction(() => {
    db.prepare("INSERT INTO spaces (id, name, kind, created_by, created_at, updated_at) VALUES (?, ?, 'team', ?, ?, ?)").run(
      id,
      cleanName(name, 'space'),
      userId,
      now,
      now,
    )
    db.prepare("INSERT INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").run(id, userId, now)
  })()
  return spaceSummary(id, userId)
}

export function updateSpace(spaceId: string, userId: string, patch: { name?: string; about?: string }): SpaceSummary {
  const space = spaceFor(spaceId, userId)
  if (patch.name !== undefined) {
    if (space.kind === 'personal') throw new AccessError('Your personal space keeps its name')
    ownerOf(spaceId, userId)
    db.prepare('UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?').run(cleanName(patch.name, 'space'), Date.now(), spaceId)
  }
  if (patch.about !== undefined) db.prepare('UPDATE spaces SET about = ?, updated_at = ? WHERE id = ?').run(patch.about.slice(0, ABOUT_MAX), Date.now(), spaceId)
  return spaceSummary(spaceId, userId)
}

/** Deletes an empty team space (its folders and library go with it). */
export function deleteSpace(spaceId: string, userId: string): void {
  const space = ownerOf(spaceId, userId)
  if (space.kind === 'personal') throw new AccessError("Your personal space can't be deleted")
  const left = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE space_id = ? AND deleted_at IS NULL').get(spaceId) as { n: number }).n
  if (left) throw new AccessError(`Move or delete its ${left === 1 ? 'storyboard' : `${left} storyboards`} first`, 409)
  db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId)
}

// ---------------------------------------------------------------- members

export function listMembers(spaceId: string, userId: string): { members: MemberInfo[]; invites: string[] } {
  spaceFor(spaceId, userId)
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, m.role FROM space_members m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name COLLATE NOCASE`,
    )
    .all(spaceId) as MemberInfo[]
  const invites = (db.prepare('SELECT email FROM space_invites WHERE space_id = ? ORDER BY invited_at').all(spaceId) as Array<{ email: string }>).map((r) => r.email)
  return { members, invites }
}

/** Adds someone by email: straight away if they've signed in here before, otherwise when they first do. */
export function addMember(spaceId: string, userId: string, email: string): { added: 'member' | 'invite' } {
  const space = ownerOf(spaceId, userId)
  if (space.kind === 'personal') throw new AccessError('Your personal space is just for you. Make a team space to work with others.')
  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AccessError('Enter an email address')
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(address) as { id: string } | undefined
  if (user) {
    db.prepare("INSERT OR IGNORE INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)").run(spaceId, user.id, Date.now())
    return { added: 'member' }
  }
  db.prepare('INSERT OR IGNORE INTO space_invites (space_id, email, invited_by, invited_at) VALUES (?, ?, ?, ?)').run(spaceId, address, userId, Date.now())
  return { added: 'invite' }
}

/** Takes someone out of a space: an owner removing anyone, or someone leaving. A space always keeps an owner. */
export function removeMember(spaceId: string, userId: string, memberId: string): void {
  const space = memberId === userId ? spaceFor(spaceId, userId) : ownerOf(spaceId, userId)
  if (space.kind === 'personal') throw new AccessError('Your personal space is just for you')
  const role = roleIn(spaceId, memberId)
  if (!role) return
  if (role === 'owner') {
    const owners = (db.prepare("SELECT COUNT(*) AS n FROM space_members WHERE space_id = ? AND role = 'owner'").get(spaceId) as { n: number }).n
    if (owners <= 1) throw new AccessError('Make someone else an owner first: a space needs one', 409)
  }
  db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, memberId)
}

export function setMemberRole(spaceId: string, userId: string, memberId: string, role: Role): void {
  ownerOf(spaceId, userId)
  if (!roleIn(spaceId, memberId)) throw new AccessError("They aren't in this space", 404)
  if (role === 'member') {
    const owners = (db.prepare("SELECT COUNT(*) AS n FROM space_members WHERE space_id = ? AND role = 'owner'").get(spaceId) as { n: number }).n
    if (owners <= 1 && roleIn(spaceId, memberId) === 'owner') throw new AccessError('A space needs an owner', 409)
  }
  db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?').run(role, spaceId, memberId)
}

export function cancelInvite(spaceId: string, userId: string, email: string): void {
  ownerOf(spaceId, userId)
  db.prepare('DELETE FROM space_invites WHERE space_id = ? AND email = ?').run(spaceId, email.trim().toLowerCase())
}

/** On signing in: join the spaces this email was added to. */
export function claimInvites(userId: string, email: string): void {
  const address = email.trim().toLowerCase()
  const invites = db.prepare('SELECT space_id FROM space_invites WHERE email = ?').all(address) as Array<{ space_id: string }>
  if (!invites.length) return
  db.transaction(() => {
    for (const { space_id } of invites) {
      db.prepare("INSERT OR IGNORE INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)").run(space_id, userId, Date.now())
    }
    db.prepare('DELETE FROM space_invites WHERE email = ?').run(address)
  })()
}

// ---------------------------------------------------------------- folders

const toFolder = (row: FolderRow): FolderInfo => ({
  id: row.id,
  spaceId: row.space_id,
  parentId: row.parent_id,
  name: row.name,
  about: row.about,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function listFolders(spaceId: string): FolderInfo[] {
  return (db.prepare('SELECT * FROM folders WHERE space_id = ? ORDER BY name COLLATE NOCASE').all(spaceId) as FolderRow[]).map(toFolder)
}

function folderRow(folderId: string): FolderRow | null {
  return (db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as FolderRow | undefined) ?? null
}

/** The folder, if this person can see its space. */
export function folderFor(folderId: string, userId: string): FolderRow {
  const row = folderRow(folderId)
  if (!row || !roleIn(row.space_id, userId)) throw new AccessError('Folder not found', 404)
  return row
}

/** From the space's top level down to this folder. */
export function folderPath(folderId: string | null): FolderRow[] {
  const path: FolderRow[] = []
  for (let id = folderId; id; ) {
    const row = folderRow(id)
    if (!row || path.some((f) => f.id === row.id)) break
    path.unshift(row)
    id = row.parent_id
  }
  return path
}

function checkFreeName(spaceId: string, parentId: string | null, name: string, except: string | null): void {
  const clash = db
    .prepare('SELECT id FROM folders WHERE space_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(spaceId, parentId, name, except) as { id: string } | undefined
  if (clash) throw new AccessError(`There's already a folder called “${name}” there`, 409)
}

export function createFolder(spaceId: string, userId: string, parentId: string | null, name: string): FolderInfo {
  spaceFor(spaceId, userId)
  if (parentId && folderFor(parentId, userId).space_id !== spaceId) throw new AccessError('That folder is in another space')
  const clean = cleanName(name, 'folder')
  checkFreeName(spaceId, parentId, clean, null)
  const id = newId()
  const now = Date.now()
  db.prepare('INSERT INTO folders (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    spaceId,
    parentId,
    clean,
    userId,
    now,
    now,
  )
  return toFolder(folderRow(id)!)
}

/** Renames a folder, changes its about text, or moves it (within its space). */
export function updateFolder(folderId: string, userId: string, patch: { name?: string; parentId?: string | null; about?: string }): FolderInfo {
  const folder = folderFor(folderId, userId)
  const now = Date.now()
  const parentId = patch.parentId !== undefined ? patch.parentId : folder.parent_id
  if (patch.parentId !== undefined && patch.parentId !== null) {
    const parent = folderFor(patch.parentId, userId)
    if (parent.space_id !== folder.space_id) throw new AccessError('Folders move within their space')
    if (folderPath(parent.id).some((f) => f.id === folderId)) throw new AccessError("A folder can't go inside itself")
  }
  const name = patch.name !== undefined ? cleanName(patch.name, 'folder') : folder.name
  if (patch.name !== undefined || patch.parentId !== undefined) checkFreeName(folder.space_id, parentId, name, folderId)
  db.prepare('UPDATE folders SET name = ?, parent_id = ?, about = ?, updated_at = ? WHERE id = ?').run(
    name,
    parentId,
    patch.about !== undefined ? patch.about.slice(0, ABOUT_MAX) : folder.about,
    now,
    folderId,
  )
  return toFolder(folderRow(folderId)!)
}

/** Deletes a folder once it holds no storyboards or folders. Its library goes with it. */
export function deleteFolder(folderId: string, userId: string): void {
  folderFor(folderId, userId)
  const folders = (db.prepare('SELECT COUNT(*) AS n FROM folders WHERE parent_id = ?').get(folderId) as { n: number }).n
  const projects = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE folder_id = ? AND deleted_at IS NULL').get(folderId) as { n: number }).n
  if (folders || projects) throw new AccessError('Move or delete what’s in it first', 409)
  db.transaction(() => {
    db.prepare('UPDATE projects SET folder_id = NULL WHERE folder_id = ?').run(folderId)
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
  })()
}

// --------------------------------------------------------------- projects

export interface Place {
  spaceId: string
  folderId: string | null
}

/** Where a new or moved project goes: a folder, a space's top level, or (by default) your personal space. */
export function placeFor(userId: string, spaceId?: string | null, folderId?: string | null): Place {
  if (folderId) {
    const folder = folderFor(folderId, userId)
    if (spaceId && folder.space_id !== spaceId) throw new AccessError('That folder is in another space')
    return { spaceId: folder.space_id, folderId: folder.id }
  }
  if (spaceId) return { spaceId: spaceFor(spaceId, userId).id, folderId: null }
  return { spaceId: personalSpace(userId).id, folderId: null }
}

export function canSeeProject(userId: string, project: Pick<ProjectRow, 'space_id' | 'deleted_at'> | null): boolean {
  return !!project && !project.deleted_at && !!roleIn(project.space_id, userId)
}

/** The project, if this person can see it. */
export function projectFor(projectId: string, userId: string): ProjectRow {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined
  if (!row || !canSeeProject(userId, row)) throw new AccessError('Project not found', 404)
  return row
}

export function moveProject(projectId: string, userId: string, to: Place): void {
  projectFor(projectId, userId)
  const place = placeFor(userId, to.spaceId, to.folderId)
  db.prepare('UPDATE projects SET space_id = ?, folder_id = ? WHERE id = ?').run(place.spaceId, place.folderId, projectId)
}

/** "ASBL Ads › Broadway", for showing where something is. */
export function placeName(place: Place): string {
  const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(place.spaceId) as { name: string } | undefined
  return [space?.name ?? 'Unknown space', ...folderPath(place.folderId).map((f) => f.name)].join(' › ')
}

/**
 * Finds a place by a path like "ASBL Ads/Broadway" (a space, then folders),
 * or by a folder or space id. Names are matched without minding case.
 */
export function placeByPath(userId: string, path: string): Place {
  const byFolder = folderRow(path.trim())
  if (byFolder && roleIn(byFolder.space_id, userId)) return { spaceId: byFolder.space_id, folderId: byFolder.id }
  const spaces = listSpaces(userId)
  const byId = spaces.find((s) => s.id === path.trim())
  if (byId) return { spaceId: byId.id, folderId: null }
  const parts = path
    .split(/[/›>]/)
    .map((p) => p.trim())
    .filter(Boolean)
  const norm = (s: string) => s.toLowerCase()
  const space = spaces.find((s) => norm(s.name) === norm(parts[0] ?? ''))
  if (!space) throw new AccessError(`No space called “${parts[0] ?? ''}”. Spaces: ${spaces.map((s) => `“${s.name}”`).join(', ')}.`, 404)
  let parentId: string | null = null
  for (const name of parts.slice(1)) {
    const next = db
      .prepare('SELECT id FROM folders WHERE space_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE')
      .get(space.id, parentId, name) as { id: string } | undefined
    if (!next) throw new AccessError(`There's no folder “${name}” in ${placeName({ spaceId: space.id, folderId: parentId })}.`, 404)
    parentId = next.id
  }
  return { spaceId: space.id, folderId: parentId }
}
