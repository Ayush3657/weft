import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  Project,
  SnapshotStore,
  WeftError,
  countWords,
  cutTimeline,
  formatDuration,
  formatSeconds,
  formatTimecode,
  graphOf,
  initProject,
  linearize,
  shotLabels,
} from '../src'

function setup(title = 'Test') {
  const doc = new Y.Doc()
  const { mainCutId, firstFrameId } = initProject(doc, { title, type: 'ad' })
  const p = new Project(doc)
  return { doc, p, main: mainCutId, first: firstFrameId }
}

const order = (p: Project, cutId: string) => linearize(p.snapshot(), cutId).map((i) => i.frameId)

/** first -> b -> c -> d */
function chain() {
  const ctx = setup()
  const b = ctx.p.appendFrame()
  const c = ctx.p.appendFrame()
  const d = ctx.p.appendFrame()
  return { ...ctx, b, c, d }
}

describe('new project', () => {
  it('has meta, a main cut and one blank frame', () => {
    const { p, main, first } = setup('Launch ad')
    const s = p.snapshot()
    expect(s.meta.title).toBe('Launch ad')
    expect(s.meta.mainCutId).toBe(main)
    expect(s.meta.fps).toBe(25)
    expect(s.cuts[main]?.isMain).toBe(true)
    expect(s.cuts[main]?.targetDuration).toBe(30)
    expect(Object.keys(s.frames)).toEqual([first])
  })
})

describe('sequence editing', () => {
  it('appends frames in order', () => {
    const { p, main, first, b, c, d } = chain()
    expect(order(p, main)).toEqual([first, b, c, d])
  })

  it('splices an inserted frame into the chain', () => {
    const { p, main, first, b, c, d } = chain()
    const x = p.insertFrameAfter(first)
    expect(order(p, main)).toEqual([first, x, b, c, d])
  })

  it('bridges the gap when a frame is deleted', () => {
    const { p, main, first, b, c, d } = chain()
    p.deleteFrames([c])
    expect(order(p, main)).toEqual([first, b, d])
    expect(Object.keys(p.snapshot().links)).toHaveLength(2)
  })

  it('refuses a link that loops back', () => {
    const { p, first, d } = chain()
    expect(() => p.linkFrames(d, first)).toThrow(WeftError)
    expect(() => p.linkFrames(d, d)).toThrow(WeftError)
  })

  it('reuses an existing link instead of duplicating it', () => {
    const { p, first, b } = chain()
    const before = Object.keys(p.snapshot().links).length
    p.linkFrames(first, b)
    expect(Object.keys(p.snapshot().links)).toHaveLength(before)
  })
})

describe('variations and cuts', () => {
  it('forks a variation and merges it back', () => {
    const { p, main, first, b, c, d } = chain()
    const alt = p.addVariation(c)
    expect(order(p, main)).toEqual([first, b, c, d])
    const labels = shotLabels(p.snapshot())
    expect(labels.get(first)).toBe('1')
    expect(labels.get(c)).toBe('3A')
    expect(labels.get(alt)).toBe('3B')
    expect(labels.get(d)).toBe('4')
    p.routeThrough(main, alt)
    expect(order(p, main)).toEqual([first, b, alt, d])
    // Letters belong to the variations, not to whichever one the cut uses.
    const after = shotLabels(p.snapshot())
    expect(after.get(c)).toBe('3A')
    expect(after.get(alt)).toBe('3B')
  })

  it('gives a third variation the next letter', () => {
    const { p, c } = chain()
    const alt1 = p.addVariation(c)
    const alt2 = p.addVariation(c)
    const labels = shotLabels(p.snapshot())
    expect([c, alt1, alt2].map((id) => labels.get(id))).toEqual(['3A', '3B', '3C'])
  })

  it("doesn't letter a link that skips ahead", () => {
    const { p, first, b, c } = chain()
    p.linkFrames(first, c) // a shortcut past b, not a variation
    const labels = shotLabels(p.snapshot())
    expect([first, b, c].map((id) => labels.get(id))).toEqual(['1', '2', '3'])
  })

  it('keeps cuts independent', () => {
    const { p, main, first, b, c, d } = chain()
    const alt = p.addVariation(c)
    const short = p.createCut('15s', { copyFrom: main })
    p.routeThrough(short, alt)
    p.setHidden(short, b, true)
    expect(order(p, short)).toEqual([first, b, alt, d])
    expect(order(p, main)).toEqual([first, b, c, d])
    const t = cutTimeline(p.snapshot(), short)
    expect(t.byFrame.get(b)?.duration).toBe(0)
    expect(t.byFrame.get(b)?.hidden).toBe(true)
  })

  it('labels frames further along a variation branch', () => {
    const { p, first, b, c } = chain()
    const alt = p.addVariation(b) // first -> alt -> c
    const alt2 = p.insertFrameAfter(alt) // first -> alt -> alt2 -> c
    const labels = shotLabels(p.snapshot())
    expect(labels.get(b)).toBe('2A')
    expect(labels.get(alt)).toBe('2B')
    expect(labels.get(alt2)).toBe('2B.2')
    expect(labels.get(c)).toBe('3')
    expect(labels.get(first)).toBe('1')
  })

  it('labels alternative openings', () => {
    const { p, main, first, b } = chain()
    const altOpen = p.addVariation(first)
    const labels = shotLabels(p.snapshot())
    expect(labels.get(first)).toBe('1A')
    expect(labels.get(altOpen)).toBe('1B')
    p.routeThrough(main, altOpen)
    expect(order(p, main).slice(0, 2)).toEqual([altOpen, b])
  })

  it('gives unconnected frames no label', () => {
    const { p } = chain()
    const loose = p.createFrame({ x: 900, y: 900 })
    expect(shotLabels(p.snapshot()).has(loose)).toBe(false)
  })

  it('ignores a stray root when picking where the cut starts', () => {
    const { p, main, first } = chain()
    p.createFrame()
    expect(order(p, main)[0]).toBe(first)
  })

  it('numbers shots by scene', () => {
    const { p, first, b, c, d } = chain()
    const s1 = p.createScene({ title: 'Lobby' })
    const s2 = p.createScene({ title: 'Terrace' })
    p.assignScene([first, b], s1)
    p.assignScene([c, d], s2)
    const labels = shotLabels(p.snapshot())
    expect([first, b, c, d].map((id) => labels.get(id))).toEqual(['1.1', '1.2', '2.1', '2.2'])
  })

  it('cleans up cut choices when a chosen frame is deleted', () => {
    const { p, main, first, b, c, d } = chain()
    const alt = p.addVariation(c)
    p.routeThrough(main, alt)
    p.deleteFrames([alt])
    expect(order(p, main)).toEqual([first, b, c, d])
  })
})

describe('rearranging', () => {
  it('detaches a frame and joins its neighbours', () => {
    const { p, main, first, b, c, d } = chain()
    p.detachFrame(c)
    expect(order(p, main)).toEqual([first, b, d])
    expect(Object.keys(p.snapshot().frames)).toContain(c)
    expect(shotLabels(p.snapshot()).has(c)).toBe(false)
  })

  it('hands a fork to the previous frame, keeping the cut on its path', () => {
    const { p, main, first, b, c, d } = chain()
    const alt = p.addVariation(c)
    p.routeThrough(main, alt)
    p.detachFrame(b)
    expect(order(p, main)).toEqual([first, alt, d])
    const outs = graphOf(p.snapshot()).out(first).map((l) => l.to)
    expect(outs.sort()).toEqual([c, alt].sort())
  })

  it('joins every branch when a merge frame is detached', () => {
    const { p, main, first, b, c, d } = chain()
    const e = p.appendFrame()
    const alt = p.addVariation(c)
    p.detachFrame(d)
    const g = graphOf(p.snapshot())
    expect(g.out(c).map((l) => l.to)).toEqual([e])
    expect(g.out(alt).map((l) => l.to)).toEqual([e])
    expect(order(p, main)).toEqual([first, b, c, e])
  })

  it('moves a frame onto a link', () => {
    const { p, main, first, b, c, d } = chain()
    const link = Object.values(p.snapshot().links).find((l) => l.from === first && l.to === b)!
    p.moveFrameToLink(d, link.id)
    expect(order(p, main)).toEqual([first, d, b, c])
  })

  it('moves a frame before or after another frame', () => {
    const { p, main, first, b, c, d } = chain()
    p.moveFrameNextTo(b, d, 'after')
    expect(order(p, main)).toEqual([first, c, d, b])
    p.moveFrameNextTo(d, first, 'before')
    expect(order(p, main)).toEqual([d, first, c, b])
  })

  it('moves a loose frame into the sequence', () => {
    const { p, main, first, b, c, d } = chain()
    const loose = p.createFrame()
    p.moveFrameNextTo(loose, b, 'after')
    expect(order(p, main)).toEqual([first, b, loose, c, d])
  })

  it('inserts a new frame before another', () => {
    const { p, main, first, b } = chain()
    const x = p.insertFrameBefore(b)
    expect(order(p, main).slice(0, 3)).toEqual([first, x, b])
    const y = p.insertFrameBefore(first)
    expect(order(p, main)[0]).toBe(y)
  })

  it('cuts several links at once', () => {
    const { p } = chain()
    const ids = Object.values(p.snapshot().links).map((l) => l.id)
    p.deleteLinks(ids.slice(0, 2))
    expect(Object.keys(p.snapshot().links)).toHaveLength(1)
  })

  it('never creates a loop when moving', () => {
    const { p, main, b, c, d } = chain()
    const link = Object.values(p.snapshot().links).find((l) => l.from === c && l.to === d)!
    p.moveFrameToLink(b, link.id)
    const s = p.snapshot()
    for (const l of Object.values(s.links)) expect(p.canReach(l.to, l.from)).toBe(false)
    expect(order(p, main)).toHaveLength(4)
  })
})

describe('audio and music', () => {
  it('times a frame from its recorded voiceover', () => {
    const { p, main, first } = setup()
    p.setVo(first, 'Some homes you buy') // estimated 1.6 s
    const asset = p.addAsset({ kind: 'audio', hash: 'a'.repeat(64), duration: 3.2, mime: 'audio/webm' })
    p.setAudioAsset(first, p.voLineId(first), asset)
    expect(cutTimeline(p.snapshot(), main).items[0]?.duration).toBeCloseTo(3.7) // recording + padding
  })

  it('keeps music and beats per cut', () => {
    const { p, main } = setup()
    const music = p.addAsset({ kind: 'audio', hash: 'b'.repeat(64), duration: 30, mime: 'audio/mpeg' })
    p.setCutMusic(main, music)
    p.addBeat(main, 1.5)
    p.addBeat(main, 0.5)
    p.addBeat(main, 1.52) // too close to 1.5, ignored
    expect(p.snapshot().cuts[main]?.beats).toEqual([0.5, 1.5])
    const short = p.createCut('15s', { copyFrom: main })
    expect(p.snapshot().cuts[short]?.music?.assetId).toBe(music)
    p.removeBeat(short, 0.52)
    expect(p.snapshot().cuts[short]?.beats).toEqual([1.5])
    expect(p.snapshot().cuts[main]?.beats).toEqual([0.5, 1.5])
  })
})

describe('timing', () => {
  it('counts words', () => {
    expect(countWords("Home is where the heart's at")).toBe(6)
    expect(countWords('  ')).toBe(0)
    expect(countWords('3 BHK homes — from ₹1.2 Cr')).toBe(6)
  })

  it('estimates duration from VO at 2.5 words per second', () => {
    const { p, main, first } = setup()
    p.setVo(first, 'Home is where the heart is') // 6 words: 2.4s + 0.5s padding
    expect(cutTimeline(p.snapshot(), main).items[0]?.duration).toBeCloseTo(2.9)
  })

  it('uses manual durations and cut overrides, and computes start times', () => {
    const { p, main, first, b, c } = chain()
    p.setDuration(first, 6)
    p.setDuration(b, 8)
    p.setOverride(main, c, 5)
    const t = cutTimeline(p.snapshot(), main)
    expect(t.items.map((i) => i.start)).toEqual([0, 6, 14, 19])
    expect(t.total).toBe(22) // 6 + 8 + 5 + 3 (default)
    p.resetDuration(first)
    expect(cutTimeline(p.snapshot(), main).items[0]?.duration).toBe(6) // no VO: falls back to its duration
  })
})

describe('snapshot store', () => {
  it('keeps unchanged frames identical between snapshots', () => {
    const { p, first, b } = chain()
    const store = new SnapshotStore(p)
    const before = store.getSnapshot()
    let notified = 0
    store.subscribe(() => notified++)
    p.setText(b, 'description', 'Drone shot over the towers')
    store.flush()
    const after = store.getSnapshot()
    expect(notified).toBe(1)
    expect(after).not.toBe(before)
    expect(after.frames[first]).toBe(before.frames[first])
    expect(after.links).toBe(before.links)
    expect(after.frames[b]?.description).toBe('Drone shot over the towers')
    store.destroy()
  })
})

describe('sync between replicas', () => {
  it('merges concurrent edits', () => {
    const a = new Y.Doc()
    const { firstFrameId } = initProject(a, { title: 'Shared' })
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = new Project(a)
    const pb = new Project(b)
    pa.appendFrame()
    pb.setText(firstFrameId, 'description', 'Opening shot')
    pb.setVo(firstFrameId, 'Welcome home')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(pa.snapshot()).toEqual(pb.snapshot())
    expect(Object.keys(pa.snapshot().frames)).toHaveLength(2)
    expect(pa.getFrame(firstFrameId)?.description).toBe('Opening shot')
  })
})

describe('formatting', () => {
  it('formats times', () => {
    expect(formatSeconds(6)).toBe('0:06')
    expect(formatSeconds(9.5)).toBe('0:09.5')
    expect(formatSeconds(62.34)).toBe('1:02.3')
    expect(formatTimecode(14, 25)).toBe('00:00:14:00')
    expect(formatTimecode(1.5, 24)).toBe('00:00:01:12')
    expect(formatDuration(2.9)).toBe('2.9s')
    expect(formatDuration(12)).toBe('12s')
  })
})
