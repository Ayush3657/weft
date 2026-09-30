import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, cameraMotion, composeAt, indexAt, initProject, musicClip, playItems, voClips } from '../src'

/** a (6s) -> b (8s) -> c (5s) -> d (11s) */
function film() {
  const doc = new Y.Doc()
  const { mainCutId, firstFrameId } = initProject(doc, { title: 'Animatic', type: 'ad' })
  const p = new Project(doc)
  const a = firstFrameId
  const b = p.appendFrame()
  const c = p.appendFrame()
  const d = p.appendFrame()
  p.setDuration(a, 6)
  p.setDuration(b, 8)
  p.setDuration(c, 5)
  p.setDuration(d, 11)
  const linkInto = (id: string) => Object.values(p.snapshot().links).find((l) => l.to === id)!.id
  return { p, main: mainCutId, a, b, c, d, linkInto }
}

describe('play items', () => {
  it('lists visible frames with start times', () => {
    const { p, main, a, b, c, d } = film()
    p.setHidden(main, b, true)
    const items = playItems(p.snapshot(), main)
    expect(items.map((i) => i.frameId)).toEqual([a, c, d])
    expect(items.map((i) => i.start)).toEqual([0, 6, 11])
    expect(items.at(-1)?.end).toBe(22)
  })

  it('finds the item playing at a time', () => {
    const { p, main } = film()
    const items = playItems(p.snapshot(), main)
    expect([0, 5.99, 6, 13.9, 14, 29, 40].map((t) => indexAt(items, t))).toEqual([0, 0, 1, 1, 2, 3, 3])
  })

  it('treats editorial transitions as cuts', () => {
    const { p, main, b, c, linkInto } = film()
    p.updateLink(linkInto(b), { transition: 'match-cut' })
    p.updateLink(linkInto(c), { transition: 'dissolve', transitionDuration: 1 })
    const items = playItems(p.snapshot(), main)
    expect(items[1]?.transitionIn).toBeNull()
    expect(items[2]?.transitionIn).toEqual({ type: 'dissolve', duration: 1 })
  })
})

describe('composition', () => {
  it('shows one frame away from transitions', () => {
    const { p, main, a } = film()
    const comp = composeAt(playItems(p.snapshot(), main), 3)
    expect(comp.layers).toEqual([{ frameId: a, opacity: 1, progress: 0.5, reveal: 1 }])
    expect(comp.fade).toBeNull()
  })

  it('crossfades a dissolve centred on the cut', () => {
    const { p, main, a, b, linkInto } = film()
    p.updateLink(linkInto(b), { transition: 'dissolve', transitionDuration: 2 })
    const items = playItems(p.snapshot(), main)
    const mid = composeAt(items, 6)
    expect(mid.layers.map((l) => [l.frameId, l.opacity])).toEqual([
      [a, 1],
      [b, 0.5],
    ])
    expect(composeAt(items, 5.5).layers[1]?.opacity).toBeCloseTo(0.25)
    expect(composeAt(items, 7).layers).toHaveLength(1)
  })

  it('fades through black: out of the old frame, into the new one', () => {
    const { p, main, a, b, linkInto } = film()
    p.updateLink(linkInto(b), { transition: 'fade-black', transitionDuration: 1 })
    const items = playItems(p.snapshot(), main)
    const before = composeAt(items, 5.75)
    expect(before.layers[0]?.frameId).toBe(a)
    expect(before.fade).toEqual({ color: 'black', opacity: 0.5 })
    const after = composeAt(items, 6.25)
    expect(after.layers[0]?.frameId).toBe(b)
    expect(after.fade?.opacity).toBeCloseTo(0.5)
  })

  it('reveals the next frame across a wipe', () => {
    const { p, main, b, linkInto } = film()
    p.updateLink(linkInto(b), { transition: 'wipe', transitionDuration: 1 })
    const comp = composeAt(playItems(p.snapshot(), main), 6)
    expect(comp.layers[1]).toMatchObject({ frameId: b, reveal: 0.5 })
  })

  it('never lets a transition run longer than the frames beside it', () => {
    const { p, main, c, linkInto } = film()
    p.setDuration(c, 1)
    p.updateLink(linkInto(c), { transition: 'dissolve', transitionDuration: 4 })
    const items = playItems(p.snapshot(), main)
    // Clamped to 1 s, so it starts 0.5 s before the cut at 14.
    expect(composeAt(items, 13.4).layers).toHaveLength(1)
    expect(composeAt(items, 13.6).layers).toHaveLength(2)
  })
})

describe('camera motion', () => {
  it('pushes in and pulls out', () => {
    expect(cameraMotion('push-in', 0).scale).toBe(1)
    expect(cameraMotion('push-in', 1).scale).toBeCloseTo(1.15)
    expect(cameraMotion('pull-out', 1).scale).toBeCloseTo(1)
  })

  it('slides the picture opposite to the pan', () => {
    expect(cameraMotion('pan-left', 1).x).toBeGreaterThan(0)
    expect(cameraMotion('pan-right', 1).x).toBeLessThan(0)
    expect(cameraMotion(null, 0.5)).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 })
  })
})

describe('audio on the timeline', () => {
  it('places recorded VO lines one after another within their frame', () => {
    const { p, main, b } = film()
    const first = p.voLineId(b)
    const second = p.addAudioLine(b, { kind: 'dialogue' })
    const clip1 = p.addAsset({ kind: 'audio', hash: '1'.repeat(64), duration: 2 })
    const clip2 = p.addAsset({ kind: 'audio', hash: '2'.repeat(64), duration: 3 })
    p.setAudioAsset(b, first, clip1)
    p.setAudioAsset(b, second, clip2)
    const clips = voClips(p.snapshot(), playItems(p.snapshot(), main))
    expect(clips.map((c) => [c.assetId, c.start, c.duration])).toEqual([
      [clip1, 6, 2],
      [clip2, 8, 3],
    ])
  })

  it('places the music bed at its offset', () => {
    const { p, main } = film()
    const song = p.addAsset({ kind: 'audio', hash: '3'.repeat(64), duration: 45 })
    p.setCutMusic(main, song)
    p.setMusicOffset(main, -2)
    expect(musicClip(p.snapshot(), main)).toMatchObject({ assetId: song, start: -2, duration: 45 })
  })
})
