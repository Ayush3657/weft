import { defaultStart, graphOf, type Graph } from './graph'
import type { CutSnapshot, LinkSnapshot, ProjectSnapshot } from './types'

export interface CutItem {
  frameId: string
  /** The link that led into this frame (null for the first frame). */
  linkInId: string | null
}

export function cutStart(s: ProjectSnapshot, cut: CutSnapshot, g: Graph = graphOf(s)): string | null {
  return cut.start && s.frames[cut.start] ? cut.start : defaultStart(s, g)
}

/** The outgoing link a cut follows from `frameId`: its explicit choice, else the oldest link. */
export function chosenLink(cut: CutSnapshot, frameId: string, g: Graph): LinkSnapshot | undefined {
  const outs = g.out(frameId)
  if (!outs.length) return undefined
  const choice = cut.choices[frameId]
  return (choice ? outs.find((l) => l.id === choice) : undefined) ?? outs[0]
}

const cache = new WeakMap<ProjectSnapshot, Map<string, CutItem[]>>()

/** The ordered frames a cut plays, hidden frames included. */
export function linearize(s: ProjectSnapshot, cutId: string): CutItem[] {
  let perCut = cache.get(s)
  if (!perCut) {
    perCut = new Map()
    cache.set(s, perCut)
  }
  const cached = perCut.get(cutId)
  if (cached) return cached

  const items: CutItem[] = []
  const cut = s.cuts[cutId]
  const g = graphOf(s)
  const start = cut ? cutStart(s, cut, g) : null
  if (cut && start) {
    const seen = new Set([start])
    items.push({ frameId: start, linkInId: null })
    let cur = start
    for (;;) {
      const link = chosenLink(cut, cur, g)
      if (!link || seen.has(link.to)) break
      seen.add(link.to)
      items.push({ frameId: link.to, linkInId: link.id })
      cur = link.to
    }
  }
  perCut.set(cutId, items)
  return items
}
