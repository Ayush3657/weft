import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, assetUsage, initProject, notesUsage, parseDuration, rowsToScript, textToTable } from '../src'

describe('AV script parsing', () => {
  it('matches columns by their header names', () => {
    const rows = rowsToScript([
      ['Sl. No.', 'Visual', 'Audio', 'Super', 'Duration'],
      ['1', 'Aerial over the towers', 'Some homes you buy.', '', '4s'],
      ['2', 'Family walks in', 'Some homes you grow into.', 'Skyline Towers', '0:03'],
    ])
    expect(rows).toEqual([
      { video: 'Aerial over the towers', audio: 'Some homes you buy.', text: '', duration: 4 },
      { video: 'Family walks in', audio: 'Some homes you grow into.', text: 'Skyline Towers', duration: 3 },
    ])
  })

  it('reads a headerless table as video, audio, text, skipping shot numbers', () => {
    const rows = rowsToScript([
      ['1', 'Close-up of keys', 'Welcome home'],
      ['2', 'Door opens', ''],
    ])
    expect(rows.map((r) => [r.video, r.audio])).toEqual([
      ['Close-up of keys', 'Welcome home'],
      ['Door opens', ''],
    ])
  })

  it('drops VO labels from the audio, keeping other sound cues', () => {
    const rows = rowsToScript([
      ['Video', 'Audio'],
      ['Drone over the lake', 'VO: Every morning starts here.'],
      ['Balcony', 'V.O. - With room to breathe.\nMVO: Skyline Towers.'],
      ['Logo', 'SFX: chime'],
    ])
    expect(rows.map((r) => r.audio)).toEqual(['Every morning starts here.', 'With room to breathe.\nSkyline Towers.', 'SFX: chime'])
  })

  it('drops empty rows and non-breaking spaces', () => {
    expect(rowsToScript([['Video', 'Audio'], [' ', ''], ['Sunset', '']])).toEqual([
      { video: 'Sunset', audio: '', text: '', duration: null },
    ])
  })

  it('turns pasted text into rows', () => {
    expect(textToTable('Shot one\tVO one\nShot two\tVO two')).toEqual([
      ['Shot one', 'VO one'],
      ['Shot two', 'VO two'],
    ])
    expect(textToTable('Opening wide shot\n\nKid presses the button')).toEqual([['Opening wide shot'], ['Kid presses the button']])
  })

  it('parses durations', () => {
    expect(['3', '3s', '2.5 sec', '0:03', '00:01:05', '4"', 'soon', ''].map(parseDuration)).toEqual([3, 3, 2.5, 3, 65, 4, null, null])
  })
})

describe('asset usage', () => {
  it('finds everywhere an asset is used', () => {
    const doc = new Y.Doc()
    const { firstFrameId, mainCutId } = initProject(doc, { title: 'Usage' })
    const p = new Project(doc)
    const img = p.addAsset({ kind: 'image', hash: 'f'.repeat(64) })
    const song = p.addAsset({ kind: 'audio', hash: '9'.repeat(64), duration: 30 })
    p.addMediaVersion(firstFrameId, img)
    p.addReference(firstFrameId, img)
    const priya = p.createBibleEntry('character', { name: 'Priya' })
    p.addBibleAsset(priya, img)
    p.addMoodItem({ kind: 'asset', assetId: img, x: 0, y: 0 })
    p.setCutMusic(mainCutId, song)
    const usage = assetUsage(p.snapshot())
    expect(usage.get(img)?.map((u) => `${u.kind}:${u.label}`)).toEqual([
      'frame-image:Frame 1',
      'frame-reference:Frame 1',
      'bible:Priya',
      'moodboard:Moodboard',
    ])
    expect(usage.get(song)?.[0]).toMatchObject({ kind: 'music', label: 'Music in Main cut' })
  })

  it('finds assets placed on notes pages', () => {
    const doc = new Y.Doc()
    initProject(doc, { title: 'Notes usage' })
    const p = new Project(doc)
    const img = p.addAsset({ kind: 'image', hash: 'a'.repeat(64) })
    const link = p.addAsset({ kind: 'link', url: 'https://example.com/' })
    const pageId = p.createPage('Research')
    const figure = new Y.XmlElement('image')
    figure.setAttribute('assetId', img)
    const card = new Y.XmlElement('linkCard')
    card.setAttribute('assetId', link)
    const again = new Y.XmlElement('image')
    again.setAttribute('assetId', img)
    p.pageFragment(pageId).insert(0, [figure, new Y.XmlElement('paragraph'), card, again])
    const usage = notesUsage(p.pageContent, p.snapshot().pages)
    expect(usage.get(img)).toEqual([{ kind: 'notes', label: 'Research', pageId }])
    expect(usage.get(link)?.map((u) => u.label)).toEqual(['Research'])
    p.deletePage(pageId)
    expect(notesUsage(p.pageContent, p.snapshot().pages).size).toBe(0)
  })
})
