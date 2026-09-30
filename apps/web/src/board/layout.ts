import { byCreation, chosenLink, graphOf, linearize, type ProjectSnapshot } from '@weft/model'

export interface Point {
  x: number
  y: number
}

/**
 * Storyboard strip layout:
 * - the cut plays along row 0, left to right
 * - each variation branch goes on the first free row below, starting in the
 *   column after the frame it forks from (or ending just before where an
 *   alternative opening merges in)
 * - frames that aren't connected to anything sit in a tray row at the bottom
 */
export function stripLayout(s: ProjectSnapshot, cutId: string, dx: number, dy: number): Map<string, Point> {
  const g = graphOf(s)
  const cut = s.cuts[cutId]
  const column = new Map<string, number>()
  const row = new Map<string, number>()
  const occupied = new Map<number, Set<number>>()

  const place = (id: string, c: number, r: number) => {
    column.set(id, c)
    row.set(id, r)
    let cells = occupied.get(r)
    if (!cells) occupied.set(r, (cells = new Set()))
    cells.add(c)
  }
  const isFree = (r: number, c0: number, length: number) => {
    const cells = occupied.get(r)
    if (!cells) return true
    for (let c = c0; c < c0 + length; c++) if (cells.has(c)) return false
    return true
  }
  const freeRow = (c0: number, length: number) => {
    let r = 1
    while (!isFree(r, c0, length)) r++
    return r
  }
  const next = (id: string) => (cut ? chosenLink(cut, id, g)?.to : g.out(id)[0]?.to)
  /** Unplaced frames from `start`, following the cut's choices, until reaching placed ones. */
  const branchFrom = (start: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    let cur: string | undefined = start
    while (cur && !column.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      out.push(cur)
      cur = next(cur)
    }
    return out
  }

  const queue = linearize(s, cutId).map((i) => i.frameId)
  queue.forEach((id, i) => place(id, i, 0))

  const expand = (from: number) => {
    for (let i = from; i < queue.length; i++) {
      const id = queue[i]!
      for (const link of g.out(id)) {
        if (column.has(link.to)) continue
        const branch = branchFrom(link.to)
        if (!branch.length) continue
        const c0 = column.get(id)! + 1
        const r = freeRow(c0, branch.length)
        branch.forEach((b, k) => place(b, c0 + k, r))
        queue.push(...branch)
      }
    }
  }
  expand(0)

  // Alternative openings and other chains that start somewhere else.
  for (const root of g.roots) {
    if (column.has(root) || g.out(root).length === 0) continue
    const branch = branchFrom(root)
    const last = branch[branch.length - 1]
    const mergesInto = last ? next(last) : undefined
    const c0 = mergesInto !== undefined && column.has(mergesInto) ? column.get(mergesInto)! - branch.length : 0
    const r = freeRow(c0, branch.length)
    branch.forEach((b, k) => place(b, c0 + k, r))
    const start = queue.length
    queue.push(...branch)
    expand(start)
  }

  // Unconnected frames: a tray row under everything else.
  const loose = Object.values(s.frames)
    .filter((f) => !column.has(f.id))
    .sort(byCreation)
  if (loose.length) {
    const trayRow = (row.size ? Math.max(...row.values()) : -1) + 1
    loose.forEach((f, k) => place(f.id, k, trayRow))
  }

  const positions = new Map<string, Point>()
  for (const [id, c] of column) positions.set(id, { x: c * dx, y: row.get(id)! * dy })
  return positions
}
