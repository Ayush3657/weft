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
/** Widths for each tool at each size: pen nibs, the lines of arrows and boxes, and how far the eraser reaches. */
export const SKETCH_SIZES: ReadonlyArray<{ id: SketchSize; label: string; pen: number; line: number; eraser: number }> = [
  { id: 's', label: 'Fine', pen: 5, line: 3, eraser: 8 },
  { id: 'm', label: 'Medium', pen: 10, line: 5, eraser: 16 },
  { id: 'l', label: 'Bold', pen: 20, line: 9, eraser: 32 },
]

export type StrokeInit = Omit<SketchStroke, 'id' | 'createdAt'>

const MAX_NUMBERS = 6000
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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

// ------------------------------------------------------------------ lines

/** A line's points split out: x, y, and pressure if it has it. */
interface Line {
  x: number[]
  y: number[]
  p: number[] | null
}

function unpack(points: readonly number[], stride: 2 | 3): Line {
  const n = Math.floor(points.length / stride)
  const line: Line = { x: [], y: [], p: stride === 3 ? [] : null }
  for (let i = 0; i < n; i++) {
    line.x.push(points[i * stride]!)
    line.y.push(points[i * stride + 1]!)
    line.p?.push(points[i * stride + 2]!)
  }
  return line
}

function pack(line: Line): number[] {
  const out: number[] = []
  for (let i = 0; i < line.x.length; i++) {
    out.push(line.x[i]!, line.y[i]!)
    if (line.p) out.push(line.p[i]!)
  }
  return out
}

/** How far along the line each point is. */
function distances(line: Line): number[] {
  const along = [0]
  for (let i = 1; i < line.x.length; i++) along.push(along[i - 1]! + Math.hypot(line.x[i]! - line.x[i - 1]!, line.y[i]! - line.y[i - 1]!))
  return along
}

const lengthOf = (line: Line) => distances(line).at(-1) ?? 0

/** The same line with its points evenly spaced, about `spacing` apart, keeping both ends. A line with no length is one point. */
function resample(line: Line, spacing: number): Line {
  const along = distances(line)
  const total = along.at(-1) ?? 0
  if (line.x.length < 2 || total === 0) return { x: line.x.slice(0, 1), y: line.y.slice(0, 1), p: line.p ? line.p.slice(0, 1) : null }
  const count = Math.max(1, Math.min(20000, Math.round(total / spacing)))
  const out: Line = { x: [], y: [], p: line.p ? [] : null }
  let i = 0
  for (let k = 0; k <= count; k++) {
    const at = (total * k) / count
    while (i < line.x.length - 2 && along[i + 1]! < at) i++
    const span = along[i + 1]! - along[i]!
    const t = span > 0 ? Math.min(1, Math.max(0, (at - along[i]!) / span)) : 0
    out.x.push(lerp(line.x[i]!, line.x[i + 1]!, t))
    out.y.push(lerp(line.y[i]!, line.y[i + 1]!, t))
    out.p?.push(lerp(line.p![i]!, line.p![i + 1]!, t))
  }
  return out
}

/**
 * Values smoothed by a Gaussian `sigma` samples wide. Past each end the
 * values are mirrored through the end point, so the ends stay put and the
 * smoothing doesn't pull them in.
 */
function blur(values: readonly number[], sigma: number): number[] {
  const n = values.length
  if (sigma <= 0 || n < 3) return [...values]
  const reach = Math.min(Math.ceil(sigma * 3), n - 1)
  const weights = Array.from({ length: reach + 1 }, (_, k) => Math.exp(-(k * k) / (2 * sigma * sigma)))
  const at = (j: number): number => {
    if (j < 0) return 2 * values[0]! - values[Math.min(n - 1, -j)]!
    if (j > n - 1) return 2 * values[n - 1]! - values[Math.max(0, 2 * (n - 1) - j)]!
    return values[j]!
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let sum = values[i]! * weights[0]!
    let total = weights[0]!
    for (let k = 1; k <= reach; k++) {
      sum += (at(i - k) + at(i + k)) * weights[k]!
      total += 2 * weights[k]!
    }
    out.push(sum / total)
  }
  // Exactly where they were, not just to within rounding.
  out[0] = values[0]!
  out[n - 1] = values[n - 1]!
  return out
}

function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance: number; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return { distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t }
}

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => toSegment(px, py, ax, ay, bx, by).distance

/**
 * Fewer points along a line, keeping its shape within `tolerance`
 * (Ramer–Douglas–Peucker), and its pressure within `pressureTolerance`.
 */
function simplify(line: Line, tolerance: number, pressureTolerance = Infinity): Line {
  const n = line.x.length
  if (n <= 2) return line
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let farthest = -1
    let worst = 1
    for (let i = first + 1; i < last; i++) {
      const { distance, t } = toSegment(line.x[i]!, line.y[i]!, line.x[first]!, line.y[first]!, line.x[last]!, line.y[last]!)
      let off = distance / tolerance
      if (line.p) off = Math.max(off, Math.abs(line.p[i]! - lerp(line.p[first]!, line.p[last]!, t)) / pressureTolerance)
      if (off > worst) {
        worst = off
        farthest = i
      }
    }
    if (farthest > 0) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  const out: Line = { x: [], y: [], p: line.p ? [] : null }
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue
    out.x.push(line.x[i]!)
    out.y.push(line.y[i]!)
    out.p?.push(line.p![i]!)
  }
  return out
}

/** Fewer points along a drawn line, keeping its shape (Ramer–Douglas–Peucker), so strokes stay small. */
export function simplifyPoints(points: readonly number[], stride: 2 | 3, tolerance = 0.8): number[] {
  return pack(simplify(unpack(points, stride), tolerance))
}

/** How many screen pixels of wobble a drawn line is smoothed over (a Gaussian's width). */
const SMOOTHING = 1.5

/**
 * A line as drawn, cleaned up: a mouse moves in whole pixels, so a shallow
 * line arrives as a staircase, and hands wobble. Both are smoothed away over
 * a pixel or two (`px` is how many sketch units a screen pixel was where it
 * was drawn), keeping the ends where they were. Then, unless it's still being
 * drawn, it's thinned to the points that carry its shape, to keep.
 */
export function smoothDrawn(points: readonly number[], stride: 2 | 3, px: number, finished = true): number[] {
  const line = unpack(points, stride)
  if (line.x.length < 3 || !(px > 0)) return [...points]
  const step = px / 2
  const even = resample(line, step)
  const smoothed: Line = {
    x: blur(even.x, (SMOOTHING * px) / step),
    y: blur(even.y, (SMOOTHING * px) / step),
    // A pen's pressure jitters more than its position.
    p: even.p ? blur(even.p, (SMOOTHING * 2 * px) / step) : null,
  }
  return pack(finished ? simplify(smoothed, px * 0.2, 0.02) : smoothed)
}

// ------------------------------------------------------------------ drawing

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

/** A closed, smooth path around perfect-freehand's outline: quadratic curves through the midpoints, bent at each point. */
function outlinePath(outline: number[][]): string {
  const n = outline.length
  if (n < 3) return ''
  const mid = (i: number) => {
    const a = outline[i % n]!
    const b = outline[(i + 1) % n]!
    return `${fixed((a[0]! + b[0]!) / 2)},${fixed((a[1]! + b[1]!) / 2)}`
  }
  let d = `M${mid(0)}`
  for (let i = 1; i <= n; i++) {
    const c = outline[i % n]!
    d += `Q${fixed(c[0]!)},${fixed(c[1]!)} ${mid(i)}`
  }
  return `${d}Z`
}

const dot = (x: number, y: number, r: number) => `M${fixed(x - r)},${fixed(y)} a${fixed(r)},${fixed(r)} 0 1,0 ${fixed(2 * r)},0 a${fixed(r)},${fixed(r)} 0 1,0 ${fixed(-2 * r)},0Z`

/** A smooth line through points (midpoints joined by quadratic curves). A point given twice makes a sharp corner. */
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

/**
 * A mouse has no pressure, so its lines are given ink's: swelling in from
 * the start and easing off at the end, the same however fast it moved.
 */
function inkPressure(along: readonly number[], size: number): number[] {
  const total = along.at(-1) ?? 0
  const rise = Math.min(size * 2, total / 3)
  const fall = Math.min(size * 1.5, total / 4)
  return along.map((s) => {
    const into = rise > 0 ? Math.min(1, s / rise) : 1
    const out = fall > 0 ? Math.min(1, (total - s) / fall) : 1
    return 0.75 - 0.3 * (1 - into) ** 2 - 0.2 * (1 - out) ** 2
  })
}

/** A pen stroke's middle line, its points evenly spaced, with how hard it pressed at each. */
const penLines = new WeakMap<SketchStroke, Line>()
function penLine(stroke: SketchStroke): Line {
  let line = penLines.get(stroke)
  if (!line) {
    line = resample(unpack(stroke.points, stroke.pressure ? 3 : 2), Math.max(1.5, stroke.size / 4))
    if (!line.p) line.p = inkPressure(distances(line), stroke.size)
    penLines.set(stroke, line)
  }
  return line
}

/** An arrow's shaft (ending under its head) and head, which points the way the line was going over its last stretch. */
function arrowParts(stroke: SketchStroke): { shaft: Array<[number, number]>; head: Array<[number, number]> } | null {
  const xy = pairs(stroke)
  if (xy.length < 2) return null
  const [tx, ty] = xy[xy.length - 1]!
  const head = Math.max(16, stroke.size * 3.6)
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
  return {
    shaft: xy.slice(0, -1).concat([[tx - ux * head * 0.6, ty - uy * head * 0.6]]),
    head: [
      [tx, ty],
      [baseX - uy * half, baseY + ux * half],
      [baseX + uy * half, baseY - ux * half],
    ],
  }
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
  if (stroke.tool === 'line') {
    return [xy.length === 1 ? { d: dot(xy[0]![0], xy[0]![1], size / 2), fill: color, stroke: null, width: 0 } : { d: smoothLine(xy), fill: null, stroke: color, width: size }]
  }
  if (stroke.tool === 'arrow') {
    const parts = arrowParts(stroke)
    if (!parts) return [{ d: dot(xy[0]![0], xy[0]![1], size), fill: color, stroke: null, width: 0 }]
    const [tip, left, right] = parts.head as [[number, number], [number, number], [number, number]]
    return [
      { d: smoothLine(parts.shaft), fill: null, stroke: color, width: size },
      {
        d: `M${fixed(tip[0])},${fixed(tip[1])} L${fixed(left[0])},${fixed(left[1])} L${fixed(right[0])},${fixed(right[1])}Z`,
        fill: color,
        stroke: color,
        width: Math.max(1, size * 0.3),
      },
    ]
  }
  // A pen stroke: an outline that swells and thins like ink, with a pen's pressure if it was drawn with one.
  const line = penLine(stroke)
  if (line.x.length === 1) return [{ d: dot(line.x[0]!, line.y[0]!, size / 2), fill: color, stroke: null, width: 0 }]
  const outline = getStroke(
    line.x.map((x, i) => [x, line.y[i]!, line.p![i]!]),
    { size, thinning: 0.55, smoothing: 0.5, streamline: 0.2, simulatePressure: false, last: true },
  )
  // The outline has a point for every point along the line; most of them aren't needed to draw it.
  const kept = simplify({ x: outline.map((o) => o[0]!), y: outline.map((o) => o[1]!), p: null }, 0.08)
  const d = outlinePath(kept.x.map((x, i) => [x, kept.y[i]!]))
  return d ? [{ d, fill: color, stroke: null, width: 0 }] : []
}

/** Whether a stroke passes within `radius` of a point (for erasing whole strokes). */
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

// ------------------------------------------------------------------ erasing

/** Where along segment a→b (0 to 1) is within `r` of point c, if anywhere. */
function nearPoint(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): [number, number] | null {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - cx
  const fy = ay - cy
  const a = dx * dx + dy * dy
  const c = fx * fx + fy * fy - r * r
  if (a === 0) return c <= 0 ? [0, 1] : null
  const b = 2 * (fx * dx + fy * dy)
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const root = Math.sqrt(disc)
  const t0 = Math.max(0, (-b - root) / (2 * a))
  const t1 = Math.min(1, (-b + root) / (2 * a))
  return t0 <= t1 ? [t0, t1] : null
}

/** Where along segment a→b is within `r` of the straight stretch of segment e→f (between its ends), if anywhere. */
function nearStretch(ax: number, ay: number, bx: number, by: number, ex: number, ey: number, fx: number, fy: number, r: number): [number, number] | null {
  const length = Math.hypot(fx - ex, fy - ey)
  if (!length) return null
  const ux = (fx - ex) / length
  const uy = (fy - ey) / length
  // Along e→f and across it, at a and how each changes towards b.
  const s0 = (ax - ex) * ux + (ay - ey) * uy
  const ds = (bx - ax) * ux + (by - ay) * uy
  const w0 = -(ax - ex) * uy + (ay - ey) * ux
  const dw = -(bx - ax) * uy + (by - ay) * ux
  let lo = 0
  let hi = 1
  // Keep the part where low <= start + t * change <= high.
  const within = (start: number, change: number, low: number, high: number): boolean => {
    if (change === 0) return start >= low && start <= high
    let t0 = (low - start) / change
    let t1 = (high - start) / change
    if (t0 > t1) [t0, t1] = [t1, t0]
    lo = Math.max(lo, t0)
    hi = Math.min(hi, t1)
    return lo <= hi
  }
  return within(s0, ds, 0, length) && within(w0, dw, -r, r) ? [lo, hi] : null
}

/** Where along segment a→b is within `r` of segment e→f: one stretch, since that region (a capsule) is convex. */
function nearSegment(ax: number, ay: number, bx: number, by: number, ex: number, ey: number, fx: number, fy: number, r: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const found of [nearPoint(ax, ay, bx, by, ex, ey, r), nearPoint(ax, ay, bx, by, fx, fy, r), nearStretch(ax, ay, bx, by, ex, ey, fx, fy, r)]) {
    if (!found) continue
    lo = Math.min(lo, found[0])
    hi = Math.max(hi, found[1])
  }
  return lo <= hi ? [lo, hi] : null
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boundsOf(x: readonly number[], y: readonly number[]): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (let i = 0; i < x.length; i++) {
    bounds.minX = Math.min(bounds.minX, x[i]!)
    bounds.maxX = Math.max(bounds.maxX, x[i]!)
    bounds.minY = Math.min(bounds.minY, y[i]!)
    bounds.maxY = Math.max(bounds.maxY, y[i]!)
  }
  return bounds
}

const overlaps = (a: Bounds, b: Bounds, margin: number) => a.minX - margin <= b.maxX && b.minX - margin <= a.maxX && a.minY - margin <= b.maxY && b.minY - margin <= a.maxY

/**
 * The stretches of a line the eraser misses, as lines, or null if it misses
 * the whole line. The eraser runs along `path` (x, y pairs) and rubs out
 * everything within `reach` of it. A closed line (a box) that's cut once is
 * still one piece.
 */
function cutLine(line: Line, path: readonly number[], reach: number, closed: boolean): Line[] | null {
  const n = line.x.length
  const ex: number[] = []
  const ey: number[] = []
  for (let i = 0; i + 1 < path.length; i += 2) {
    ex.push(path[i]!)
    ey.push(path[i + 1]!)
  }
  if (!n || !ex.length) return null
  if (ex.length === 1) {
    ex.push(ex[0]!)
    ey.push(ey[0]!)
  }
  if (!overlaps(boundsOf(line.x, line.y), boundsOf(ex, ey), reach)) return null
  const pointAt = (i: number, t: number): [number, number, number | null] => [
    lerp(line.x[i]!, line.x[i + 1]!, t),
    lerp(line.y[i]!, line.y[i + 1]!, t),
    line.p ? lerp(line.p[i]!, line.p[i + 1]!, t) : null,
  ]
  if (n === 1) {
    for (let j = 0; j + 1 < ex.length; j++) if (distanceToSegment(line.x[0]!, line.y[0]!, ex[j]!, ey[j]!, ex[j + 1]!, ey[j + 1]!) <= reach) return []
    return null
  }

  type Piece = { line: Line; fromStart: boolean; toEnd: boolean }
  const pieces: Piece[] = []
  let current: Piece | null = null
  let cut = false
  const add = (piece: Piece, [x, y, p]: [number, number, number | null]) => {
    piece.line.x.push(x)
    piece.line.y.push(y)
    if (piece.line.p) piece.line.p.push(p ?? 0.5)
  }
  for (let i = 0; i < n - 1; i++) {
    const seg = boundsOf([line.x[i]!, line.x[i + 1]!], [line.y[i]!, line.y[i + 1]!])
    const gone: Array<[number, number]> = []
    for (let j = 0; j + 1 < ex.length; j++) {
      if (!overlaps(seg, boundsOf([ex[j]!, ex[j + 1]!], [ey[j]!, ey[j + 1]!]), reach)) continue
      const found = nearSegment(line.x[i]!, line.y[i]!, line.x[i + 1]!, line.y[i + 1]!, ex[j]!, ey[j]!, ex[j + 1]!, ey[j + 1]!, reach)
      // Grazing a single point doesn't cut anything.
      if (found && found[1] - found[0] > 1e-9) gone.push(found)
    }
    // What's left of this segment, from 0 to 1.
    gone.sort((a, b) => a[0] - b[0])
    const left: Array<[number, number]> = []
    let from = 0
    for (const [a, b] of gone) {
      if (a > from) left.push([from, a])
      from = Math.max(from, b)
    }
    if (from < 1) left.push([from, 1])
    if (gone.length) cut = true
    if (current && (!left.length || left[0]![0] > 0)) {
      pieces.push(current)
      current = null
    }
    for (const [a, b] of left) {
      if (!current) {
        current = { line: { x: [], y: [], p: line.p ? [] : null }, fromStart: i === 0 && a === 0, toEnd: false }
        add(current, pointAt(i, a))
      }
      add(current, pointAt(i, b))
      if (b < 1) {
        pieces.push(current)
        current = null
      }
    }
  }
  if (current) {
    current.toEnd = true
    pieces.push(current)
  }
  if (!cut) return null
  // A box cut once is one line, around its starting corner.
  if (closed && pieces.length > 1 && pieces[0]!.fromStart && pieces.at(-1)!.toEnd) {
    const first = pieces.shift()!
    const last = pieces.pop()!
    const joined: Line = { x: last.line.x.concat(first.line.x), y: last.line.y.concat(first.line.y), p: last.line.p && first.line.p ? last.line.p.concat(first.line.p) : null }
    pieces.unshift({ line: joined, fromStart: false, toEnd: false })
  }
  return pieces.map((piece) => piece.line)
}

/** Whether the eraser comes within `reach` of a triangle (an arrowhead). */
function touchesTriangle(path: readonly number[], triangle: ReadonlyArray<[number, number]>, reach: number): boolean {
  const [a, b, c] = triangle as [[number, number], [number, number], [number, number]]
  const side = (p: [number, number], q: [number, number], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
  for (let i = 0; i + 1 < path.length; i += 2) {
    const x = path[i]!
    const y = path[i + 1]!
    const s1 = side(a, b, x, y)
    const s2 = side(b, c, x, y)
    const s3 = side(c, a, x, y)
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true
  }
  // The eraser's path near any edge.
  const edges: Array<[[number, number], [number, number]]> = [
    [a, b],
    [b, c],
    [c, a],
  ]
  const path2 = path.length >= 4 ? path : [...path, ...path]
  for (const [p, q] of edges) {
    for (let i = 0; i + 3 < path2.length; i += 2) {
      if (nearSegment(p[0], p[1], q[0], q[1], path2[i]!, path2[i + 1]!, path2[i + 2]!, path2[i + 3]!, reach)) return true
    }
  }
  return false
}

const boundsCache = new WeakMap<SketchStroke, Bounds>()
function strokeBounds(stroke: SketchStroke): Bounds {
  let bounds = boundsCache.get(stroke)
  if (!bounds) {
    const xy = pairs(stroke)
    bounds = xy.length ? boundsOf(xy.map((p) => p[0]), xy.map((p) => p[1])) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    boundsCache.set(stroke, bounds)
  }
  return bounds
}

/**
 * What's left of a stroke after rubbing out along `path` (x, y pairs, in
 * sketch units) with an eraser that reaches `radius` around it: null if it
 * missed the stroke, else the pieces still there, in order (none if it's all
 * gone). Pen pieces keep the ink's swell they had; boxes become lines; an
 * arrow's head stays on the piece that still has its tip, unless the eraser
 * touched the head. Pieces get ids made from the stroke's.
 */
export function eraseStroke(stroke: SketchStroke, path: readonly number[], radius: number): SketchStroke[] | null {
  if (path.length < 2) return null
  const pen = stroke.tool === 'pen'
  const half = pen ? stroke.size * 0.7 : stroke.size / 2
  const reach = radius + half
  const near = strokeBounds(stroke)
  const ex: number[] = []
  const ey: number[] = []
  for (let i = 0; i + 1 < path.length; i += 2) {
    ex.push(path[i]!)
    ey.push(path[i + 1]!)
  }
  // Arrowheads stick out past the line; leave room for them.
  const margin = reach + (stroke.tool === 'arrow' ? Math.max(16, stroke.size * 3.6) : 0)
  if (!overlaps(near, boundsOf(ex, ey), margin)) return null

  let line: Line
  let closed = false
  if (pen) line = penLine(stroke)
  else if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = stroke.points
    // Round the box from a corner, each corner twice so lines cut from it keep them sharp.
    line = { x: [x1, x2, x2, x2, x2, x1, x1, x1], y: [y1, y1, y1, y2, y2, y2, y2, y1], p: null }
    closed = true
  } else line = unpack(stroke.points, stroke.pressure ? 3 : 2)
  if (!pen && line.p) line = { ...line, p: null }

  const head = stroke.tool === 'arrow' ? arrowParts(stroke)?.head : undefined
  const headGone = !!head && touchesTriangle(path, head, radius)
  const pieces = cutLine(line, path, reach, closed)
  if (!pieces && !headGone) return null
  // Bits shorter than the line is wide would only be blobs.
  const kept = (pieces ?? [line]).filter((piece) => piece.x.length > 1 && lengthOf(piece) >= half)
  const tipX = line.x.at(-1)
  const tipY = line.y.at(-1)
  return kept.map((piece, k) => {
    const id = `${stroke.id}.${k}`
    if (pen) return { ...stroke, id, tool: 'pen', points: pack(simplify(piece, 0.1, 0.02)), pressure: true }
    const keepsHead = stroke.tool === 'arrow' && !headGone && piece.x.at(-1) === tipX && piece.y.at(-1) === tipY
    return { ...stroke, id, tool: keepsHead ? 'arrow' : 'line', points: pack(piece), pressure: false }
  })
}

// ------------------------------------------------------------------ whole sketches

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
    [count('line'), 'line', 'lines'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => (n === 1 ? `1 ${one as string}` : `${n as number} ${many as string}`))
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing')
}
