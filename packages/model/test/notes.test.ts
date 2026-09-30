import { Node, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, appendMarkdown, initProject, markdownToBlocks, notesToMarkdown } from '../src'

// The notes editor's schema: StarterKit plus Weft's two blocks (their node views live in the web app).
const schema = getSchema([
  StarterKit.configure({ undoRedo: false }),
  Node.create({
    name: 'media',
    group: 'block',
    atom: true,
    addAttributes: () => ({ assetId: { default: null }, kind: { default: 'image' }, src: { default: null }, alt: { default: '' } }),
  }),
  Node.create({
    name: 'linkCard',
    group: 'block',
    atom: true,
    addAttributes: () => ({ assetId: { default: null }, url: { default: '' }, title: { default: '' } }),
  }),
])

function page(markdown: string) {
  const doc = new Y.Doc()
  const fragment = doc.getXmlFragment('page')
  appendMarkdown(fragment, markdown)
  return fragment
}

describe('notes as Markdown', () => {
  const sample = [
    '# Opening',
    'Some homes you **buy**. Some you *grow into*, see [the brief](https://example.com/brief).',
    '- Aerial at dawn',
    '  - golden hour',
    '- Family walks in',
    '1. First',
    '2. Second',
    '> Warm, never salesy.',
    '---',
    '```',
    'SUPER: 3 BHK from ₹1.2 Cr',
    '```',
  ].join('\n')

  it('round-trips headings, formatting, links, lists, quotes, rules and code', () => {
    expect(notesToMarkdown(page(sample))).toBe(
      [
        '# Opening',
        'Some homes you **buy**. Some you *grow into*, see [the brief](https://example.com/brief).',
        '- Aerial at dawn\n  - golden hour\n- Family walks in',
        '1. First\n2. Second',
        '> Warm, never salesy.',
        '---',
        '```\nSUPER: 3 BHK from ₹1.2 Cr\n```',
      ].join('\n\n'),
    )
  })

  it('writes documents the notes editor can open, marks and all', () => {
    const node = yXmlFragmentToProseMirrorRootNode(page(sample), schema)
    expect(() => node.check()).not.toThrow()
    expect(node.childCount).toBe(7)
    expect(node.child(0).type.name).toBe('heading')
    expect(node.child(0).attrs.level).toBe(1)
    const marks = new Set<string>()
    node.child(1).forEach((child) => child.marks.forEach((m) => marks.add(m.type.name)))
    expect([...marks].sort()).toEqual(['bold', 'italic', 'link'])
    expect(node.child(2).type.name).toBe('bulletList')
    expect(node.child(2).child(0).childCount).toBe(2)
    expect(node.child(3).type.name).toBe('orderedList')
    expect(node.child(4).type.name).toBe('blockquote')
    expect(node.child(5).type.name).toBe('horizontalRule')
    expect(node.child(6).type.name).toBe('codeBlock')
  })

  it('turns bare links into links and joins wrapped lines', () => {
    const md = notesToMarkdown(page('Reference: https://vimeo.com/76979871\nsecond line'))
    expect(md).toBe('Reference: [https://vimeo.com/76979871](https://vimeo.com/76979871) second line')
  })

  it('shows pictures and link cards', () => {
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment('page')
    const media = new Y.XmlElement('media')
    media.setAttribute('assetId', 'a1')
    media.setAttribute('alt', 'golden-hour.png')
    const card = new Y.XmlElement('linkCard')
    card.setAttribute('url', 'https://vimeo.com/1')
    card.setAttribute('title', 'Reel')
    fragment.insert(0, [media, card])
    expect(notesToMarkdown(fragment)).toBe('![golden-hour.png](asset:a1)\n\n[Reel](https://vimeo.com/1)')
  })

  it('writes over the empty paragraph the editor leaves at the end', () => {
    const doc = new Y.Doc()
    initProject(doc, { title: 'Notes' })
    const p = new Project(doc)
    const fragment = p.pageFragment('notes')
    fragment.insert(0, [markdownToBlocks('Existing idea')[0]!, new Y.XmlElement('paragraph')])
    p.appendToPage('notes', '## Added by Claude\nA new line')
    expect(notesToMarkdown(fragment)).toBe('Existing idea\n\n## Added by Claude\n\nA new line')
    expect(fragment.length).toBe(3)
  })
})

describe('change sets', () => {
  it('records what an assistant did, outside undo history', () => {
    const doc = new Y.Doc()
    const { firstFrameId } = initProject(doc, { title: 'Changes' })
    const origin = { source: 'local' }
    const p = new Project(doc, origin)
    const undo = new Y.UndoManager(p.roots, { trackedOrigins: new Set([origin]) })
    const id = p.startChangeSet({ agent: 'Claude', userId: 'u1', userName: 'Ayush' })
    p.noteChange(id, 'Rewrote the VO in frame 1', [firstFrameId])
    p.noteChange(id, 'Tagged frame 1', [firstFrameId])
    expect(undo.canUndo()).toBe(false)
    const set = p.snapshot().changes[id]!
    expect(set).toMatchObject({ agent: 'Claude', userName: 'Ayush', status: 'open', undoable: true, frameIds: [firstFrameId] })
    expect(set.summary).toEqual(['Rewrote the VO in frame 1', 'Tagged frame 1'])
    p.setChangeStatus(id, 'kept')
    p.setChangeUndoable(id, false)
    expect(p.snapshot().changes[id]).toMatchObject({ status: 'kept', undoable: false })
  })
})
