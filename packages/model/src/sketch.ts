import { getStroke } from 'perfect-freehand'
import { SKETCH_TOOLS, type SketchStroke } from './types'

/**
 * A frame's sketch layer: pen strokes, arrows (for camera and subject moves)
 * and boxes (for framings), drawn over its picture or on a blank frame.
 * Everything is in sketch units: the frame is 1000 wide and as tall as its
 * aspect ratio makes it, so a sketch scales with whatever shows it.
 */

export const SKETCH_WIDTH = 1000
export const sketchHeight = (aspect: number) => Math.round((SKETCH_WIDTH / aspect) * 10) / 10

/** The paper a sketch on a frame without a picture is drawn on. */
export const SKETCH_PAPER = '#f3f1ec'

export const SKETCH_COLORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '#161616', label: 'Black' },
  { id: '#ffffff', label: 'White' },
  { id: '#e5484d', label: 'Red' },
  { id: '#f5a623', label: 'Orange' },
  { id: '#2fbf71', label: 'Green' },
  { id: '#3e8ef7', label: 'Blue' },
]

export type SketchSize = 's' | 'm' | 'l'
/** Widths for each tool at each size: pen nibs, and the lines of arrows and boxes. */
export const SKETCH_SIZES: ReadonlyArray<{ id: SketchSize; label: string; pen: number; line: number }> = [
  { id: 's', label: 'Fine', pen: 5, line: 3 },
  { id: 'm', label: 'Medium', pen: 10, line: 5 },
  { id: 'l', label: 'Bold', pen: 20, line: 9 },
]

export type StrokeInit = Omit<SketchStroke, 'id' | 'createdAt'>

const MAX_NUMBERS = 6000
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** A stroke's numbers tidied for storing: rounded, in range, and not too many. */
export function cleanStroke(stroke: SketchStroke): SketchStroke {
  const stride = stroke.pressure ? 3 : 2
  const count = Math.min(Math.floor(stroke.points.length / stride), Math.floor(MAX_NUMBERS / stride))
  const points: number[] = []
  for (let i = 0; i < count; i++) {
    const at = i * stride
    points.push(round(Number(stroke.points[at]) || 0, 1), round(Number(stroke.points[at + 1]) || 0, 1))
    if (stride === 3) points.push(round(Math.min(1, Math.max(0, Number(stroke.points[at + 2]) || 0.5)), 2))
  }
  return {
    id: stroke.id,
    tool: SKETCH_TOOLS.includes(stroke.tool) ? stroke.tool : 'pen',
    color: /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color.toLowerCase() : '#161616',
    size: round(Math.min(80, Math.max(0.5, Number(stroke.size) || 5)), 1),
    points,
    pressure: stroke.pressure && stride === 3,
    createdBy: stroke.createdBy ?? null,
    createdAt: stroke.createdAt,
  }
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Fewer points along a drawn line, keeping its shape (Ramer–Douglas–Peucker), so strokes stay small. */
export function simplifyPoints(points: readonly number[], stride: 2 | 3, tolerance = 0.8): number[] {
  const n = Math.floor(points.length / stride)
  if (n <= 2) return [...points]
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let farthest = -1
    let distance = tolerance
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(
        points[i * stride]!,
        points[i * stride + 1]!,
        points[first * stride]!,
        points[first * stride + 1]!,
        points[last * stride]!,
        points[last * stride + 1]!,
      )
      if (d > distance) {
        distance = d
        farthest = i
      }
    }
    if (farthest > 0) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) for (let k = 0; k < stride; k++) out.push(points[i * stride + k]!)
  return out
}

/** How to draw part of a stroke in SVG. */
export interface SketchShape {
  d: string
  /** Filled (a pen stroke's outline, an arrowhead), or null. */
  fill: string | null
  /** Drawn as a line of `width`, or null. */
  stroke: string | null
  width: number
}

const fixed = (n: number) => (Math.round(n * 10) / 10).toString()

/** A closed, smooth path around perfect-freehand's outline. */
function outlinePath(outline: number[][]): string {
  if (outline.length < 4) return ''
  const mid = (a: number, b: number) => fixed((a + b) / 2)
  const [a, b, c] = outline as [number[], number[], number[]]
  let d = `M${fixed(a[0]!)},${fixed(a[1]!)} Q${fixed(b[0]!)},${fixed(b[1]!)} ${mid(b[0]!, c[0]!)},${mid(b[1]!, c[1]!)} T`
  for (let i = 2; i < outline.length - 1; i++) d += `${mid(outline[i]![0]!, outline[i + 1]![0]!)},${mid(outline[i]![1]!, outline[i + 1]![1]!)} `
  return `${d}Z`
}

const dot = (x: number, y: number, r: number) => `M${fixed(x - r)},${fixed(y)} a${fixed(r)},${fixed(r)} 0 1,0 ${fixed(2 * r)},0 a${fixed(r)},${fixed(r)} 0 1,0 ${fixed(-2 * r)},0Z`

/** A smooth line through points (midpoints joined by quadratic curves). */
function smoothLine(xy: ReadonlyArray<[number, number]>): string {
  if (xy.length === 1) return `M${fixed(xy[0]![0])},${fixed(xy[0]![1])}`
  if (xy.length === 2) return `M${fixed(xy[0]![0])},${fixed(xy[0]![1])} L${fixed(xy[1]![0])},${fixed(xy[1]![1])}`
  let d = `M${fixed(xy[0]![0])},${fixed(xy[0]![1])}`
  for (let i = 1; i < xy.length - 1; i++) {
    const [x, y] = xy[i]!
    const [nx, ny] = xy[i + 1]!
    d += ` Q${fixed(x)},${fixed(y)} ${fixed((x + nx) / 2)},${fixed((y + ny) / 2)}`
  }
  const [lx, ly] = xy[xy.length - 1]!
  return `${d} L${fixed(lx)},${fixed(ly)}`
}

function pairs(stroke: SketchStroke): Array<[number, number]> {
  const stride = stroke.pressure ? 3 : 2
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < stroke.points.length; i += stride) out.push([stroke.points[i]!, stroke.points[i + 1]!])
  return out
}

/** The SVG shapes that draw a stroke. */
export function strokeShapes(stroke: SketchStroke): SketchShape[] {
  const { color, size } = stroke
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = stroke.points
    return [{ d: `M${fixed(x1)},${fixed(y1)} H${fixed(x2)} V${fixed(y2)} H${fixed(x1)}Z`, fill: null, stroke: color, width: size }]
  }
  const xy = pairs(stroke)
  if (!xy.length) return []
  if (stroke.tool === 'arrow') {
    if (xy.length === 1) return [{ d: dot(xy[0]![0], xy[0]![1], size), fill: color, stroke: null, width: 0 }]
    // The head points the way the line was going over its last stretch.
    const [tx, ty] = xy[xy.length - 1]!
    const head = Math.max(16, size * 3.6)
    let bx = xy[0]![0]
    let by = xy[0]![1]
    for (let i = xy.length - 2; i >= 0; i--) {
      ;[bx, by] = xy[i]!
      if (Math.hypot(tx - bx, ty - by) >= head) break
    }
    const length = Math.hypot(tx - bx, ty - by) || 1
    const ux = (tx - bx) / length
    const uy = (ty - by) / length
    const baseX = tx - ux * head
    const baseY = ty - uy * head
    const half = head * 0.42
    const shaft = xy.slice(0, -1).concat([[tx - ux * head * 0.6, ty - uy * head * 0.6]])
    return [
      { d: smoothLine(shaft), fill: null, stroke: color, width: size },
      {
        d: `M${fixed(tx)},${fixed(ty)} L${fixed(baseX - uy * half)},${fixed(baseY + ux * half)} L${fixed(baseX + uy * half)},${fixed(baseY - ux * half)}Z`,
        fill: color,
        stroke: color,
        width: Math.max(1, size * 0.3),
      },
    ]
  }
  // A pen stroke: an outline that swells and thins like ink, with a pen's pressure if it was drawn with one.
  const input = stroke.pressure ? xy.map(([x, y], i) => [x, y, stroke.points[i * 3 + 2] ?? 0.5]) : xy.map(([x, y]) => [x, y])
  if (input.length === 1) return [{ d: dot(xy[0]![0], xy[0]![1], size / 2), fill: color, stroke: null, width: 0 }]
  const outline = getStroke(input, {
    size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !stroke.pressure,
    last: true,
  })
  const d = outlinePath(outline)
  return d ? [{ d, fill: color, stroke: null, width: 0 }] : []
}

/** Whether a stroke passes within `radius` of a point (for the eraser). */
export function strokeHit(stroke: SketchStroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.size / 2
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = stroke.points
    return (
      distanceToSegment(x, y, x1, y1, x2, y1) <= reach ||
      distanceToSegment(x, y, x2, y1, x2, y2) <= reach ||
      distanceToSegment(x, y, x2, y2, x1, y2) <= reach ||
      distanceToSegment(x, y, x1, y2, x1, y1) <= reach
    )
  }
  const xy = pairs(stroke)
  if (xy.length === 1) return Math.hypot(x - xy[0]![0], y - xy[0]![1]) <= reach
  for (let i = 1; i < xy.length; i++) if (distanceToSegment(x, y, xy[i - 1]![0], xy[i - 1]![1], xy[i]![0], xy[i]![1]) <= reach) return true
  return false
}

/** The SVG elements for a sketch, inside a viewBox of 0 0 1000 sketchHeight(aspect). */
export function sketchElements(strokes: readonly SketchStroke[]): string {
  return strokes
    .flatMap((s) => strokeShapes(s))
    .map((shape) =>
      shape.stroke
        ? `<path d="${shape.d}" fill="${shape.fill ?? 'none'}" stroke="${shape.stroke}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="${shape.d}" fill="${shape.fill ?? 'none'}"/>`,
    )
    .join('')
}

/**
 * A whole sketch as an SVG document, sized `width` by `height` (the frame's
 * shape), for exports and for the pictures Claude looks at. With a
 * background colour it stands alone; without one it lays over a picture.
 */
export function sketchSvg(strokes: readonly SketchStroke[], aspect: number, options: { width?: number; height?: number; background?: string | null } = {}): string {
  const width = options.width ?? SKETCH_WIDTH
  const height = options.height ?? Math.round(width / aspect)
  const background = options.background ? `<rect width="1000" height="${sketchHeight(aspect)}" fill="${options.background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${SKETCH_WIDTH} ${sketchHeight(aspect)}" preserveAspectRatio="none">${background}${sketchElements(strokes)}</svg>`
}

/** "3 pen strokes, 2 arrows and a box", for describing a sketch in words. */
export function describeSketch(strokes: readonly SketchStroke[]): string {
  const count = (tool: SketchStroke['tool']) => strokes.filter((s) => s.tool === tool).length
  const parts = [
    [count('pen'), 'pen stroke', 'pen strokes'],
    [count('arrow'), 'arrow', 'arrows'],
    [count('box'), 'box', 'boxes'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => (n === 1 ? `1 ${one as string}` : `${n as number} ${many as string}`))
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing')
}
