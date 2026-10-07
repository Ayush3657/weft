import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, describeSketch, eraseStroke, initProject, simplifyPoints, sketchSvg, smoothDrawn, strokeHit, strokeShapes, type SketchStroke } from '../src'

function setup() {
  const doc = new Y.Doc()
  const { firstFrameId } = initProject(doc, { title: 'Sketches', type: 'ad' })
  return { doc, p: new Project(doc), frameId: firstFrameId }
}

const stroke = (patch: Partial<SketchStroke>): SketchStroke => ({
  id: 's1',
  tool: 'pen',
  color: '#161616',
  size: 10,
  points: [100, 100, 300, 120, 500, 200],
  pressure: false,
  createdBy: null,
  createdAt: 0,
  ...patch,
})

describe('the sketch layer', () => {
  it('keeps strokes on the frame, tidied, in drawing order', () => {
    const { p, frameId } = setup()
    const first = p.addStroke(frameId, { tool: 'pen', color: '#E5484D', size: 999, points: [10.04, 20.06, 30.111, 40.99], pressure: false, createdBy: 'u1' })
    const second = p.addStroke(frameId, { tool: 'arrow', color: 'not a colour', size: 6, points: [0, 0, 400, 300], pressure: false, createdBy: 'u1' })
    const sketch = p.snapshot().frames[frameId]!.sketch
    expect(sketch.map((s) => s.id)).toEqual([first, second])
    expect(sketch[0]).toMatchObject({ color: '#e5484d', size: 80, points: [10, 20.1, 30.1, 41] })
    expect(sketch[1]!.color).toBe('#161616')

    p.removeStrokes(frameId, [first])
    expect(p.snapshot().frames[frameId]!.sketch.map((s) => s.id)).toEqual([second])
    p.clearSketch(frameId)
    expect(p.snapshot().frames[frameId]!.sketch).toEqual([])
  })

  it('starts every new frame with its own layer, so two people drawing at once both keep their strokes', () => {
    const { doc, p, frameId } = setup()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    p.addStroke(frameId, { tool: 'pen', color: '#161616', size: 5, points: [0, 0, 10, 10], pressure: false, createdBy: 'a' })
    new Project(other).addStroke(frameId, { tool: 'box', color: '#3e8ef7', size: 5, points: [0, 0, 100, 100], pressure: false, createdBy: 'b' })
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other))
    expect(p.snapshot().frames[frameId]!.sketch.map((s) => s.tool).sort()).toEqual(['box', 'pen'])
  })

  it('draws pens as filled ink, arrows with a head, and boxes as rectangles', () => {
    const pen = strokeShapes(stroke({}))
    expect(pen).toHaveLength(1)
    expect(pen[0]).toMatchObject({ fill: '#161616', stroke: null })
    expect(pen[0]!.d).toMatch(/^M.*Z$/)

    const arrow = strokeShapes(stroke({ tool: 'arrow', points: [0, 0, 200, 0] }))
    expect(arrow).toHaveLength(2)
    expect(arrow[0]).toMatchObject({ fill: null, stroke: '#161616' })
    // The head's tip is the arrow's end.
    expect(arrow[1]!.d.startsWith('M200,0')).toBe(true)

    expect(strokeShapes(stroke({ tool: 'box', points: [10, 20, 110, 220] }))[0]!.d).toBe('M10,20 H110 V220 H10Z')
  })

  it('finds strokes under the eraser', () => {
    const line = stroke({ points: [0, 0, 100, 0], size: 4 })
    expect(strokeHit(line, 50, 5, 4)).toBe(true)
    expect(strokeHit(line, 50, 40, 4)).toBe(false)
    const box = stroke({ tool: 'box', points: [0, 0, 100, 100], size: 2 })
    expect(strokeHit(box, 100, 50, 3)).toBe(true)
    expect(strokeHit(box, 50, 50, 3)).toBe(false)
  })

  it('keeps fewer points along a drawn line, keeping its shape', () => {
    const straight = [0, 0, 1, 0.01, 2, 0, 3, 0.02, 4, 0]
    expect(simplifyPoints(straight, 2)).toEqual([0, 0, 4, 0])
    const corner = [0, 0, 50, 0, 100, 0, 100, 50, 100, 100]
    expect(simplifyPoints(corner, 2)).toEqual([0, 0, 100, 0, 100, 100])
  })

  it('smooths the stair-steps out of a line drawn with a mouse', () => {
    // A mouse reports whole pixels, so a shallow line arrives as a staircase. Here a pixel is 0.75 sketch units.
    const px = 0.75
    const points: number[] = []
    for (let i = 0; i <= 400; i++) points.push(100 + i * px, 100 + Math.round(i * 0.3) * px)
    const out = smoothDrawn(points, 2, px)
    // The ends stay where they were drawn.
    expect(out.slice(0, 2)).toEqual([100, 100])
    expect(out.slice(-2)).toEqual(points.slice(-2))
    // In between it runs within a fifth of a pixel of the straight line, on far fewer points.
    let worst = 0
    for (let i = 0; i < out.length; i += 2) worst = Math.max(worst, Math.abs(out[i + 1]! - (100 + (out[i]! - 100) * 0.3)))
    expect(worst).toBeLessThan(0.2 * px)
    expect(out.length).toBeLessThan(points.length / 10)
  })

  it('gives a mouse line the same width all along, like ink', () => {
    const [shape] = strokeShapes(stroke({ points: [0, 100, 500, 100], size: 10 }))
    const numbers = (shape!.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    const across: number[] = []
    for (let i = 0; i + 1 < numbers.length; i += 2) across.push(Math.abs(numbers[i + 1]! - 100))
    // Ink at full swell is about 1.3 times the nib.
    expect(Math.max(...across)).toBeGreaterThan(6.2)
    expect(Math.max(...across)).toBeLessThan(6.6)
    // Its long edges are straight, so the outline needs points only at the rounded ends.
    expect((shape!.d.match(/Q/g) ?? []).length).toBeLessThan(80)
    expect(shape!.d).toMatch(/Q[\d.]+,93\.6 [\d.]+,93\.6/)
  })

  it('rubs out just what the eraser goes over', () => {
    const line = stroke({ id: 'a', points: [0, 100, 400, 100], size: 10 })
    // Down across the middle: the eraser reaches 10, and the ink is 7 either side of its line.
    const pieces = eraseStroke(line, [200, 50, 200, 150], 10)!
    expect(pieces.map((s) => s.tool)).toEqual(['pen', 'pen'])
    const [left, right] = pieces as [SketchStroke, SketchStroke]
    const xs = (s: SketchStroke) => s.points.filter((_, i) => i % 3 === 0)
    expect(Math.max(...xs(left))).toBeCloseTo(183, 5)
    expect(Math.min(...xs(right))).toBeCloseTo(217, 5)
    // The pieces keep the ink's swell: thin where the stroke began, full where it was cut.
    expect(left.pressure).toBe(true)
    expect(left.points[2]).toBeCloseTo(0.45, 2)
    expect(left.points.at(-1)).toBeCloseTo(0.75, 2)
    expect(right.points[2]).toBeCloseTo(0.75, 2)
    expect(pieces.map((s) => s.id)).toEqual(['a.0', 'a.1'])
    // Missed it: nothing changes. Went over all of it: nothing's left.
    expect(eraseStroke(line, [200, 300, 250, 300], 10)).toBeNull()
    expect(eraseStroke(line, [0, 100, 400, 100], 10)).toEqual([])
  })

  it('cuts boxes into lines that keep their corners, and arrows keep their heads', () => {
    const box = stroke({ id: 'b', tool: 'box', points: [100, 100, 300, 200], size: 4 })
    const tidy = (s: SketchStroke) => s.points.map((n) => Math.round(n * 10) / 10)
    // Through the top edge: one line, from the cut round the other sides and back, each corner twice so it stays sharp.
    const once = eraseStroke(box, [200, 80, 200, 120], 5)!
    expect(once.map((s) => s.tool)).toEqual(['line'])
    expect(tidy(once[0]!)).toEqual([207, 100, 300, 100, 300, 100, 300, 200, 300, 200, 100, 200, 100, 200, 100, 100, 100, 100, 193, 100])
    // Through the top and the bottom: two lines.
    expect(eraseStroke(box, [200, 80, 200, 220], 5)).toHaveLength(2)

    const arrow = stroke({ id: 'r', tool: 'arrow', points: [0, 0, 400, 0], size: 5 })
    // Across the shaft: the start becomes a line, the end keeps its head.
    expect(eraseStroke(arrow, [200, -50, 200, 50], 8)!.map((s) => s.tool)).toEqual(['line', 'arrow'])
    // Over the head: the head goes, and the rest is a line.
    expect(eraseStroke(arrow, [395, -30, 395, 30], 8)!.map((s) => s.tool)).toEqual(['line'])
    // Lines are drawn as lines.
    expect(strokeShapes(once[0]!)[0]).toMatchObject({ fill: null, stroke: '#161616', width: 4 })
  })

  it('swaps an erased stroke for its pieces, in its place', () => {
    const { p, frameId } = setup()
    const init = { tool: 'pen' as const, color: '#161616', size: 10, pressure: false, createdBy: 'u1' }
    const below = p.addStroke(frameId, { ...init, points: [0, 0, 50, 50] })
    const target = p.addStroke(frameId, { ...init, points: [0, 100, 400, 100] })
    const above = p.addStroke(frameId, { ...init, points: [0, 200, 50, 250] })
    const before = p.snapshot().frames[frameId]!.sketch
    const pieces = eraseStroke(before[1]!, [200, 50, 200, 150], 10)!
    p.replaceStrokes(frameId, new Map([[target, pieces]]))
    const after = p.snapshot().frames[frameId]!.sketch
    expect(after).toHaveLength(4)
    expect(after[0]!.id).toBe(below)
    expect(after[3]!.id).toBe(above)
    expect(after.slice(1, 3).every((s) => s.pressure && s.createdAt === before[1]!.createdAt && s.createdBy === 'u1')).toBe(true)
    // Everything rubbed out: the stroke just goes.
    p.replaceStrokes(frameId, new Map([[after[1]!.id, []]]))
    expect(p.snapshot().frames[frameId]!.sketch).toHaveLength(3)
  })

  it('makes a standalone SVG, and says what a sketch holds', () => {
    const svg = sketchSvg([stroke({}), stroke({ id: 's2', tool: 'arrow' })], 16 / 9, { width: 640, background: '#ffffff' })
    expect(svg).toContain('width="640" height="360"')
    expect(svg).toContain('viewBox="0 0 1000 562.5"')
    expect(svg).toContain('fill="#ffffff"')
    expect((svg.match(/<path/g) ?? []).length).toBe(3)
    expect(describeSketch([stroke({}), stroke({ id: 'b', tool: 'arrow' }), stroke({ id: 'c', tool: 'arrow' })])).toBe('1 pen stroke and 2 arrows')
  })
})
