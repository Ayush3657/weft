import { newId } from '@weft/model'
import { db, type LibraryItemRow, type ProjectRow } from './db'
import { getMedia } from './media'
import { AccessError, folderFor, folderPath, roleIn, spaceFor, type Place } from './spaces'

/**
 * Libraries: what the team knows about the things it makes storyboards for.
 * A space and each of its folders can hold an about text (facts, highlights,
 * lines every ad must include) and pictures, clips and sound with tags.
 * A project sees the libraries of its folder and every folder above it, up
 * to its space, and nothing from anywhere else.
 */

export interface LibraryItem {
  id: string
  spaceId: string
  folderId: string | null
  hash: string
  kind: 'image' | 'video' | 'audio'
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  caption: string
  tags: string[]
  /** Tags Claude suggested, waiting for a person to keep or drop them. */
  suggestedTags: string[]
  addedBy: { id: string; name: string } | null
  addedAt: number
}

export interface LibraryLevel {
  spaceId: string
  folderId: string | null
  name: string
  about: string
  items: LibraryItem[]
}

const parseTags = (json: string): string[] => {
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Tags are short, lower case and unique: "aerial", "clubhouse", "dusk", "3bhk". */
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = []
  for (const tag of tags) {
    const clean = tag.replace(/^#/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40)
    if (clean && !out.includes(clean)) out.push(clean)
  }
  return out.slice(0, 40)
}

const ITEM_SELECT = 'SELECT library_items.*, users.name AS adder_name FROM library_items LEFT JOIN users ON users.id = library_items.added_by'

const toItem = (row: LibraryItemRow & { adder_name: string | null }): LibraryItem => ({
  id: row.id,
  spaceId: row.space_id,
  folderId: row.folder_id,
  hash: row.hash,
  kind: row.kind,
  name: row.name,
  mime: row.mime,
  size: row.size,
  width: row.width,
  height: row.height,
  duration: row.duration,
  caption: row.caption,
  tags: parseTags(row.tags),
  suggestedTags: parseTags(row.suggested_tags),
  addedBy: row.added_by ? { id: row.added_by, name: row.adder_name ?? '' } : null,
  addedAt: row.added_at,
})

function itemRow(itemId: string): (LibraryItemRow & { adder_name: string | null }) | null {
  return (db.prepare(`${ITEM_SELECT} WHERE library_items.id = ?`).get(itemId) as (LibraryItemRow & { adder_name: string | null }) | undefined) ?? null
}

/** The item, if this person can see its space. */
export function itemFor(itemId: string, userId: string): LibraryItem {
  const row = itemRow(itemId)
  if (!row || !roleIn(row.space_id, userId)) throw new AccessError('Not in the library', 404)
  return toItem(row)
}

function itemsAt(place: Place): LibraryItem[] {
  return (
    db
      .prepare(`${ITEM_SELECT} WHERE library_items.space_id = ? AND library_items.folder_id IS ? ORDER BY library_items.added_at DESC`)
      .all(place.spaceId, place.folderId) as Array<LibraryItemRow & { adder_name: string | null }>
  ).map(toItem)
}

/** One space's or folder's library. */
export function libraryAt(userId: string, place: Place): LibraryLevel {
  const space = spaceFor(place.spaceId, userId)
  if (place.folderId) {
    const folder = folderFor(place.folderId, userId)
    if (folder.space_id !== place.spaceId) throw new AccessError('That folder is in another space')
    return { spaceId: space.id, folderId: folder.id, name: folder.name, about: folder.about, items: itemsAt(place) }
  }
  return { spaceId: space.id, folderId: null, name: space.name, about: space.about, items: itemsAt(place) }
}

/** Every library a project can draw on: its space's, then each folder's down to the project's own. */
export function libraryChain(project: Pick<ProjectRow, 'space_id' | 'folder_id'>, userId: string): LibraryLevel[] {
  const levels = [libraryAt(userId, { spaceId: project.space_id, folderId: null })]
  for (const folder of folderPath(project.folder_id)) levels.push(libraryAt(userId, { spaceId: project.space_id, folderId: folder.id }))
  return levels
}

/** How many library items each folder (and the space's top level, under '') holds. */
export function libraryCounts(spaceId: string): Record<string, number> {
  const rows = db.prepare('SELECT folder_id, COUNT(*) AS n FROM library_items WHERE space_id = ? GROUP BY folder_id').all(spaceId) as Array<{
    folder_id: string | null
    n: number
  }>
  return Object.fromEntries(rows.map((r) => [r.folder_id ?? '', r.n]))
}

export interface NewItem {
  hash: string
  name: string
  mime: string
  width?: number | null
  height?: number | null
  duration?: number | null
  caption?: string
  tags?: readonly string[]
}

const kindOf = (mime: string): LibraryItem['kind'] | null =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : null

/** Adds an uploaded file to a library. The same file twice in one place stays one item. */
export function addLibraryItem(userId: string, place: Place, input: NewItem): LibraryItem {
  libraryAt(userId, place)
  const media = getMedia(input.hash)
  if (!media) throw new AccessError("That file hasn't reached the server. Upload it first.")
  const kind = kindOf(media.mime) ?? kindOf(input.mime)
  if (!kind) throw new AccessError('Libraries hold pictures, video and sound')
  const existing = db
    .prepare('SELECT id FROM library_items WHERE space_id = ? AND folder_id IS ? AND hash = ?')
    .get(place.spaceId, place.folderId, input.hash) as { id: string } | undefined
  if (existing) return itemFor(existing.id, userId)
  const id = newId()
  db.prepare(
    `INSERT INTO library_items (id, space_id, folder_id, hash, kind, name, mime, size, width, height, duration, caption, tags, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    place.spaceId,
    place.folderId,
    input.hash,
    kind,
    input.name.trim().slice(0, 200) || 'Untitled',
    media.mime,
    media.size,
    input.width ?? null,
    input.height ?? null,
    input.duration ?? null,
    (input.caption ?? '').trim().slice(0, 2000),
    JSON.stringify(cleanTags(input.tags ?? [])),
    userId,
    Date.now(),
  )
  return itemFor(id, userId)
}

export interface ItemPatch {
  name?: string
  caption?: string
  tags?: readonly string[]
  /** Suggested tags to keep (they become tags) and to drop. */
  accept?: readonly string[]
  reject?: readonly string[]
  /** Move it to another folder in its space (null: the space's top level). */
  folderId?: string | null
}

export function updateLibraryItem(itemId: string, userId: string, patch: ItemPatch): LibraryItem {
  const item = itemFor(itemId, userId)
  let tags = patch.tags !== undefined ? cleanTags(patch.tags) : item.tags
  let suggested = item.suggestedTags
  if (patch.accept?.length) {
    const keep = cleanTags(patch.accept)
    tags = cleanTags([...tags, ...keep])
    suggested = suggested.filter((t) => !keep.includes(t))
  }
  if (patch.reject?.length) {
    const drop = cleanTags(patch.reject)
    suggested = suggested.filter((t) => !drop.includes(t))
  }
  suggested = suggested.filter((t) => !tags.includes(t))
  let folderId = item.folderId
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null && folderFor(patch.folderId, userId).space_id !== item.spaceId) throw new AccessError('Library items move within their space')
    folderId = patch.folderId
  }
  db.prepare('UPDATE library_items SET name = ?, caption = ?, tags = ?, suggested_tags = ?, folder_id = ? WHERE id = ?').run(
    patch.name !== undefined ? patch.name.trim().slice(0, 200) || item.name : item.name,
    patch.caption !== undefined ? patch.caption.trim().slice(0, 2000) : item.caption,
    JSON.stringify(tags),
    JSON.stringify(suggested),
    folderId,
    itemId,
  )
  return itemFor(itemId, userId)
}

/** Claude's tag ideas, kept apart from the item's tags until a person keeps them. */
export function suggestTags(itemId: string, userId: string, tags: readonly string[]): LibraryItem {
  const item = itemFor(itemId, userId)
  const fresh = cleanTags(tags).filter((t) => !item.tags.includes(t))
  const suggested = cleanTags([...item.suggestedTags, ...fresh])
  db.prepare('UPDATE library_items SET suggested_tags = ? WHERE id = ?').run(JSON.stringify(suggested), itemId)
  return itemFor(itemId, userId)
}

/** Takes it out of the library. The file itself stays, since storyboards may use it. */
export function deleteLibraryItem(itemId: string, userId: string): void {
  itemFor(itemId, userId)
  db.prepare('DELETE FROM library_items WHERE id = ?').run(itemId)
}

/** Items whose name, caption or tags match every word of the query, and that have all the given tags. */
export function searchItems(items: readonly LibraryItem[], query: string, tags: readonly string[] = [], kind?: LibraryItem['kind']): LibraryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const wanted = cleanTags(tags)
  return items.filter((item) => {
    if (kind && item.kind !== kind) return false
    if (wanted.some((t) => !item.tags.includes(t))) return false
    const text = `${item.name} ${item.caption} ${item.tags.join(' ')}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}
