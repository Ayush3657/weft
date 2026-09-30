import type { LinkSnapshot, ProjectSnapshot } from './types'

interface Created {
  createdAt: number
  id: string
}

/** Oldest first; ties broken by id so every client agrees on the order. */
export function byCreation(a: Created, b: Created): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export interface Graph {
  /** Outgoing links, oldest first. The oldest is the default path at a fork. */
  out(frameId: string): readonly LinkSnapshot[]
  in(frameId: string): readonly LinkSnapshot[]
  /** Frames with no incoming links, oldest first. */
  readonly roots: readonly string[]
}

const EMPTY: readonly LinkSnapshot[] = []
const cache = new WeakMap<ProjectSnapshot, Graph>()

export function graphOf(s: ProjectSnapshot): Graph {
  const cached = cache.get(s)
  if (cached) return cached
  const outgoing = new Map<string, LinkSnapshot[]>()
  const incoming = new Map<string, LinkSnapshot[]>()
  for (const link of Object.values(s.links)) {
    if (!s.frames[link.from] || !s.frames[link.to]) continue
    push(outgoing, link.from, link)
    push(incoming, link.to, link)
  }
  for (const list of outgoing.values()) list.sort(byCreation)
  for (const list of incoming.values()) list.sort(byCreation)
  const roots = Object.values(s.frames)
    .filter((f) => !incoming.has(f.id))
    .sort(byCreation)
    .map((f) => f.id)
  const graph: Graph = {
    out: (id) => outgoing.get(id) ?? EMPTY,
    in: (id) => incoming.get(id) ?? EMPTY,
    roots,
  }
  cache.set(s, graph)
  return graph
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function canReach(g: Graph, from: string, to: string): boolean {
  const stack = [from]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === to) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const l of g.out(cur)) stack.push(l.to)
  }
  return false
}

export function reachableCount(g: Graph, from: string): number {
  const stack = [from]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const l of g.out(cur)) stack.push(l.to)
  }
  return seen.size
}

/**
 * Where a cut starts when it hasn't picked a start frame: the root that leads
 * to the most frames, so a stray unlinked frame never hijacks the sequence.
 */
export function defaultStart(s: ProjectSnapshot, g = graphOf(s)): string | null {
  let best: string | null = null
  let bestCount = -1
  for (const root of g.roots) {
    const count = reachableCount(g, root)
    if (count > bestCount) {
      best = root
      bestCount = count
    }
  }
  return best
}
