import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, SnapshotStore, initProject } from '../src'

function setup() {
  const doc = new Y.Doc()
  const ids = initProject(doc, { title: 'Write', type: 'ad' })
  return { doc, p: new Project(doc), ...ids }
}

describe('notes pages', () => {
  it('starts every project with a notes page', () => {
    const { p } = setup()
    expect(Object.values(p.snapshot().pages).map((page) => page.title)).toEqual(['Notes'])
    expect(p.ensureNotesPage()).toBe('notes')
  })

  it('creates, renames and deletes pages with their content', () => {
    const { p } = setup()
    const id = p.createPage('Ideas')
    p.pageFragment(id).insert(0, [new Y.XmlText('Rooftop party idea')])
    p.renamePage(id, 'Rough ideas')
    expect(p.snapshot().pages[id]?.title).toBe('Rough ideas')
    p.deletePage(id)
    expect(p.snapshot().pages[id]).toBeUndefined()
    expect(p.pageContent.has(id)).toBe(false)
  })

  it('brings a deleted page back with its content on undo, without capturing typing', () => {
    const doc = new Y.Doc()
    initProject(doc, { title: 'Undo' })
    const origin = { source: 'local' }
    const p = new Project(doc, origin)
    const undo = new Y.UndoManager(p.roots, { trackedOrigins: new Set([origin]) })
    const id = p.createPage('Ideas')
    undo.stopCapturing()
    // The notes editor writes with its own origin, which this undo manager ignores.
    doc.transact(() => p.pageFragment(id).insert(0, [new Y.XmlText('Rooftop party idea')]), 'editor')
    undo.stopCapturing()
    p.deletePage(id)
    expect(p.pageContent.has(id)).toBe(false)
    undo.undo()
    expect(p.snapshot().pages[id]?.title).toBe('Ideas')
    expect(p.pageFragment(id).toString()).toBe('Rooftop party idea')
    undo.undo()
    expect(p.snapshot().pages[id]).toBeUndefined()
  })

  it("doesn't rebuild the snapshot while a note is typed", () => {
    const { p } = setup()
    const store = new SnapshotStore(p)
    const before = store.getSnapshot()
    let notified = 0
    store.subscribe(() => notified++)
    p.pageFragment('notes').insert(0, [new Y.XmlText('Some homes you buy')])
    store.flush()
    expect(notified).toBe(0)
    expect(store.getSnapshot()).toBe(before)
    store.destroy()
  })
})

describe('bible', () => {
  it('keeps entries with descriptions and references, and tags frames', () => {
    const { p, firstFrameId } = setup()
    const priya = p.createBibleEntry('character', { name: 'Priya', description: 'Architect, early 30s' })
    const ref = p.addAsset({ kind: 'image', hash: 'c'.repeat(64) })
    p.addBibleAsset(priya, ref)
    p.toggleFrameTag(firstFrameId, priya)
    const s = p.snapshot()
    expect(s.bible[priya]).toMatchObject({ kind: 'character', name: 'Priya', description: 'Architect, early 30s', assetIds: [ref] })
    expect(s.frames[firstFrameId]?.tags).toEqual([priya])
    p.toggleFrameTag(firstFrameId, priya)
    expect(p.snapshot().frames[firstFrameId]?.tags).toEqual([])
  })

  it('untags frames when an entry is deleted', () => {
    const { p, firstFrameId } = setup()
    const lobby = p.createBibleEntry('location', { name: 'Grand lobby' })
    p.toggleFrameTag(firstFrameId, lobby)
    p.deleteBibleEntry(lobby)
    expect(p.snapshot().bible[lobby]).toBeUndefined()
    expect(p.snapshot().frames[firstFrameId]?.tags).toEqual([])
  })

  it('stores the brief', () => {
    const { p } = setup()
    p.briefText('logline').insert(0, 'A family finds room to grow')
    const style = p.addAsset({ kind: 'image', hash: 'd'.repeat(64) })
    p.addStyleRef(style)
    p.addStyleRef(style)
    expect(p.snapshot().brief).toMatchObject({ logline: 'A family finds room to grow', styleRefs: [style] })
  })
})

describe('moodboard', () => {
  it('adds, moves and deletes items', () => {
    const { p } = setup()
    const note = p.addMoodItem({ kind: 'note', text: 'Warm, late light', x: 10.4, y: 20, w: 220, h: 140 })
    const swatch = p.addMoodItem({ kind: 'color', color: '#e9687a', x: 300, y: 20 })
    p.setMoodPositions({ [note]: { x: 50, y: 60 } })
    p.updateMoodItem(swatch, { color: '#264d73', w: 120 })
    const s = p.snapshot()
    expect(s.moodboard[note]).toMatchObject({ kind: 'note', text: 'Warm, late light', x: 50, y: 60, w: 220 })
    expect(s.moodboard[swatch]).toMatchObject({ color: '#264d73', w: 120 })
    p.deleteMoodItems([note])
    expect(Object.keys(p.snapshot().moodboard)).toEqual([swatch])
  })

  it('removes an asset from everywhere when it is deleted', () => {
    const { p, firstFrameId } = setup()
    const img = p.addAsset({ kind: 'image', hash: 'e'.repeat(64) })
    const entry = p.createBibleEntry('product', { name: 'Tower B' })
    p.addBibleAsset(entry, img)
    p.addStyleRef(img)
    p.addReference(firstFrameId, img)
    p.addMoodItem({ kind: 'asset', assetId: img, x: 0, y: 0 })
    p.deleteAsset(img)
    const s = p.snapshot()
    expect(s.assets[img]).toBeUndefined()
    expect(s.bible[entry]?.assetIds).toEqual([])
    expect(s.brief.styleRefs).toEqual([])
    expect(s.frames[firstFrameId]?.references).toEqual([])
    expect(Object.keys(s.moodboard)).toHaveLength(0)
  })

  it('keeps link previews on link assets', () => {
    const { p } = setup()
    const link = p.addAsset({ kind: 'link', url: 'https://youtu.be/abc', title: 'Reference reel', preview: 'https://i.ytimg.com/x.jpg', site: 'YouTube' })
    expect(p.snapshot().assets[link]).toMatchObject({ kind: 'link', preview: 'https://i.ytimg.com/x.jpg', site: 'YouTube' })
    expect(p.addAsset({ kind: 'link', url: 'https://youtu.be/abc' })).toBe(link)
  })
})
