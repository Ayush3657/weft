import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, describeSketch, initProject, simplifyPoints, sketchSvg, strokeHit, strokeShapes, type SketchStroke } from '../src'

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

  it('makes a standalone SVG, and says what a sketch holds', () => {
    const svg = sketchSvg([stroke({}), stroke({ id: 's2', tool: 'arrow' })], 16 / 9, { width: 640, background: '#ffffff' })
    expect(svg).toContain('width="640" height="360"')
    expect(svg).toContain('viewBox="0 0 1000 562.5"')
    expect(svg).toContain('fill="#ffffff"')
    expect((svg.match(/<path/g) ?? []).length).toBe(3)
    expect(describeSketch([stroke({}), stroke({ id: 'b', tool: 'arrow' }), stroke({ id: 'c', tool: 'arrow' })])).toBe('1 pen stroke and 2 arrows')
  })
})
