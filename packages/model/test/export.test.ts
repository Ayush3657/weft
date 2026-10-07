import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, exportProject, initProject, mediaFileName, safeFileName, scriptsMarkdown, type AssetSnapshot } from '../src'

describe('project folders', () => {
  it('names files so they work on Windows, macOS and Linux', () => {
    expect(safeFileName('Skyline: Towers / 30s?')).toBe('Skyline Towers 30s')
    expect(safeFileName('  Lobby...  ')).toBe('Lobby')
    expect(safeFileName('CON')).toBe('CON_')
    expect(safeFileName('???', 'Untitled')).toBe('Untitled')
  })

  it('names media readably, with the start of the hash so names never clash', () => {
    const asset = { hash: 'a'.repeat(64), name: 'Golden hour.PNG', title: '', mime: 'image/png', kind: 'image' } as AssetSnapshot
    expect(mediaFileName(asset)).toBe('Golden hour-aaaaaaaaaa.png')
    expect(mediaFileName({ ...asset, mime: 'video/quicktime', name: 'take 3.mov' })).toBe('take 3-aaaaaaaaaa.mov')
    expect(mediaFileName({ ...asset, hash: null })).toBeNull()
  })

  it('writes a readable project.json and script', () => {
    const doc = new Y.Doc()
    const { firstFrameId, mainCutId } = initProject(doc, { title: 'Skyline Towers 30s', type: 'ad', targetDuration: 30 })
    const p = new Project(doc)
    p.setText(firstFrameId, 'description', 'Aerial over the towers at dawn')
    p.setVo(firstFrameId, 'Some homes you buy.')
    p.addStroke(firstFrameId, { tool: 'arrow', color: '#e5484d', size: 5, points: [100, 400, 600, 300], pressure: false, createdBy: null })
    const img = p.addAsset({ kind: 'image', hash: 'b'.repeat(64), name: 'aerial.png', mime: 'image/png' })
    p.addMediaVersion(firstFrameId, img)
    const priya = p.createBibleEntry('character', { name: 'Priya' })
    p.toggleFrameTag(firstFrameId, priya)
    p.appendFrame(mainCutId, { description: 'Logo', onScreenText: 'SKYLINE TOWERS', durationMode: 'manual', duration: 2 })

    const place = { space: 'ASBL Ads', spaceId: 'space1', folders: ['Broadway'], folderId: 'folder1' }
    const out = exportProject(p.snapshot(), { projectId: 'proj123', notes: [{ id: 'notes', title: 'Notes', markdown: '# Ideas' }], place })
    expect(out).toMatchObject({ weft: 1, projectId: 'proj123', title: 'Skyline Towers 30s', type: 'ad', place })
    expect(out.savedAt).toBeUndefined()
    expect(out.cuts[0]!.shots.map((s) => s.shot)).toEqual(['1', '2'])
    const first = out.frames.find((f) => f.id === firstFrameId)!
    expect(first).toMatchObject({ picture: 'media/aerial-bbbbbbbbbb.png', sketch: 'sketches/Shot 1.svg', inShot: ['Priya'], lengthFrom: 'voiceover' })
    expect(out.frames.find((f) => f.shot === '2')!.sketch).toBeNull()
    expect(first.audio[0]).toMatchObject({ kind: 'vo', text: 'Some homes you buy.' })
    expect(out.notes).toEqual([{ title: 'Notes', markdown: '# Ideas' }])
    expect(out.media).toEqual([expect.objectContaining({ file: 'media/aerial-bbbbbbbbbb.png', hash: 'b'.repeat(64) })])

    const script = scriptsMarkdown(p.snapshot())
    expect(script).toContain('# Skyline Towers 30s')
    expect(script).toContain('| 1 | Aerial over the towers at dawn | VO: Some homes you buy. |   |')
    expect(script).toContain('| 2 | Logo |   | SKYLINE TOWERS | 2s |')
  })
})
