import * as Y from 'yjs'
import { shotLabels } from './numbering'
import type { ProjectSnapshot } from './types'

export type UsageKind = 'frame-image' | 'frame-reference' | 'vo' | 'bible' | 'style' | 'moodboard' | 'music' | 'notes'

export interface Usage {
  kind: UsageKind
  /** What it's used by, in words: "Frame 3A", "Priya", "Moodboard". */
  label: string
  frameId?: string
  entryId?: string
  pageId?: string
}

const cache = new WeakMap<ProjectSnapshot, ReadonlyMap<string, Usage[]>>()

/** Where every asset is used, for the Library. Notes pages aren't scanned. */
export function assetUsage(s: ProjectSnapshot): ReadonlyMap<string, Usage[]> {
  const cached = cache.get(s)
  if (cached) return cached
  const usage = new Map<string, Usage[]>()
  const add = (assetId: string, u: Usage) => {
    const list = usage.get(assetId)
    if (list) list.push(u)
    else usage.set(assetId, [u])
  }
  const labels = shotLabels(s)
  for (const frame of Object.values(s.frames)) {
    const label = `Frame ${labels.get(frame.id) ?? '(unlinked)'}`
    for (const v of frame.media) add(v.assetId, { kind: 'frame-image', label, frameId: frame.id })
    for (const r of frame.references) add(r, { kind: 'frame-reference', label, frameId: frame.id })
    for (const line of frame.audio) if (line.assetId) add(line.assetId, { kind: 'vo', label, frameId: frame.id })
  }
  for (const entry of Object.values(s.bible)) {
    for (const a of entry.assetIds) add(a, { kind: 'bible', label: entry.name || 'Bible entry', entryId: entry.id })
  }
  for (const a of s.brief.styleRefs) add(a, { kind: 'style', label: 'Style references' })
  for (const item of Object.values(s.moodboard)) if (item.assetId) add(item.assetId, { kind: 'moodboard', label: 'Moodboard' })
  for (const cut of Object.values(s.cuts)) if (cut.music) add(cut.music.assetId, { kind: 'music', label: `Music in ${cut.name}` })
  cache.set(s, usage)
  return usage
}

/**
 * Assets placed on notes pages (images and link cards carry an `assetId`
 * attribute). Pages are rich text, so they're scanned separately from the snapshot.
 */
export function notesUsage(pageContent: Y.Map<Y.XmlFragment>, pages: ProjectSnapshot['pages']): Map<string, Usage[]> {
  const usage = new Map<string, Usage[]>()
  pageContent.forEach((fragment, pageId) => {
    const page = pages[pageId]
    if (!page || !(fragment instanceof Y.XmlFragment)) return
    const seen = new Set<string>()
    const walker = fragment.createTreeWalker((node) => node instanceof Y.XmlElement && typeof node.getAttribute('assetId') === 'string')
    for (const node of walker) {
      const assetId = (node as Y.XmlElement).getAttribute('assetId') as string
      if (seen.has(assetId)) continue
      seen.add(assetId)
      const u: Usage = { kind: 'notes', label: page.title || 'Untitled page', pageId }
      const list = usage.get(assetId)
      if (list) list.push(u)
      else usage.set(assetId, [u])
    }
  })
  return usage
}
