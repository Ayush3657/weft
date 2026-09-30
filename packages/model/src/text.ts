import type * as Y from 'yjs'

/**
 * Makes `ytext` equal `next` by replacing only the changed middle section, so
 * concurrent edits elsewhere in the same text survive the merge.
 */
export function applyTextDiff(ytext: Y.Text, next: string): void {
  const prev = ytext.toString()
  if (prev === next) return
  const max = Math.min(prev.length, next.length)
  let start = 0
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  if (endPrev > start) ytext.delete(start, endPrev - start)
  if (endNext > start) ytext.insert(start, next.slice(start, endNext))
}
