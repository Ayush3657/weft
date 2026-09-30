import { chosenLink, linearize } from './cut'
import { graphOf } from './graph'
import type { ProjectSnapshot } from './types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function letter(index: number): string {
  return index < 26 ? LETTERS[index]! : LETTERS[Math.floor(index / 26) - 1]! + LETTERS[index % 26]!
}

const cache = new WeakMap<ProjectSnapshot, ReadonlyMap<string, string>>()

/**
 * Shot labels, following the main cut:
 * - in order along the main cut: 1, 2, 3 (or 1.1, 1.2, 2.1 when frames belong to scenes)
 * - variations at a fork: 3A, 3B, 3C in the order they were created, so a
 *   variation keeps its letter when a cut switches between them
 * - frames further along a variation branch: 3B.2, 3B.3
 * Frames that aren't connected to the story get no label.
 */
export function shotLabels(s: ProjectSnapshot): ReadonlyMap<string, string> {
  const cached = cache.get(s)
  if (cached) return cached
  const labels = new Map<string, string>()
  cache.set(s, labels)

  const mainCut = s.cuts[s.meta.mainCutId]
  if (!mainCut) return labels
  const g = graphOf(s)
  const path = linearize(s, mainCut.id).map((item) => item.frameId)

  const sceneNumbers = new Map<string, number>()
  for (const id of path) {
    const sceneId = s.frames[id]?.sceneId
    if (sceneId && s.scenes[sceneId] && !sceneNumbers.has(sceneId)) sceneNumbers.set(sceneId, sceneNumbers.size + 1)
  }
  const perScene = new Map<string, number>()
  let plain = 0
  for (const id of path) {
    const sceneId = s.frames[id]?.sceneId
    const sceneNo = sceneId ? sceneNumbers.get(sceneId) : undefined
    if (sceneId && sceneNo !== undefined) {
      const k = (perScene.get(sceneId) ?? 0) + 1
      perScene.set(sceneId, k)
      labels.set(id, `${sceneNo}.${k}`)
    } else {
      labels.set(id, String(++plain))
    }
  }

  // Letter the variations. `null` is the virtual fork before the first frame
  // (alternative openings).
  const lettered = new Set<string>()
  const forks: Array<string | null> = [null, ...path.filter((id) => g.out(id).length > 1)]
  const processed = new Set<string | null>()
  while (forks.length) {
    const fork = forks.shift()!
    if (processed.has(fork)) continue
    processed.add(fork)

    // Every way out of the fork, oldest first (roots and links are already sorted by creation).
    let chosenEntry: string | undefined
    let entries: string[]
    if (fork === null) {
      chosenEntry = path[0]
      entries = g.roots.filter((r) => r === chosenEntry || g.out(r).length > 0)
    } else {
      chosenEntry = chosenLink(mainCut, fork, g)?.to
      entries = g.out(fork).map((l) => l.to)
    }
    if (!chosenEntry || lettered.has(chosenEntry)) continue
    const base = labels.get(chosenEntry)
    if (base === undefined) continue
    // Links that jump to an already-numbered frame (skipping ahead) aren't variations.
    const variations = entries.filter((id, i) => entries.indexOf(id) === i && (id === chosenEntry || !labels.has(id)))
    if (variations.length < 2) continue

    variations.forEach((entry, i) => {
      const suffix = letter(i)
      if (entry === chosenEntry) {
        labels.set(entry, `${base}${suffix}`)
        lettered.add(entry)
        return
      }
      let cur: string | undefined = entry
      let k = 1
      while (cur && !labels.has(cur)) {
        labels.set(cur, k === 1 ? `${base}${suffix}` : `${base}${suffix}.${k}`)
        if (k === 1) lettered.add(cur)
        if (g.out(cur).length > 1) forks.push(cur)
        k++
        cur = chosenLink(mainCut, cur, g)?.to
      }
    })
  }
  return labels
}
