import type { AssetSnapshot, MoodItemSnapshot } from '@weft/model'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const GAP = 24
const SECTION_PAD = 24
const SECTION_HEADER = 48
const SECTION_GAP = 56

/** A new item's size: pictures keep their shape, links and audio get a card. */
export function moodSize(asset: AssetSnapshot | undefined | null): { w: number; h: number } {
  if (asset?.kind === 'link') return { w: 280, h: asset.preview ? 236 : 112 }
  if (asset?.kind === 'audio') return { w: 300, h: 104 }
  const ratio = asset?.width && asset.height ? asset.height / asset.width : 0.75
  const w = ratio > 1.3 ? 200 : 280
  return { w, h: Math.round(Math.min(520, Math.max(90, w * ratio))) }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Which section each item sits in (by its centre), or null. */
export function sectionOf(item: Box, sections: readonly (Box & { id: string })[]): string | null {
  const cx = item.x + item.w / 2
  const cy = item.y + item.h / 2
  return sections.find((s) => cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h)?.id ?? null
}

/** Rows, left to right, wrapping at `maxWidth`; positions relative to the top-left. */
function shelf(items: readonly MoodItemSnapshot[], maxWidth: number) {
  const placed = new Map<string, { x: number; y: number }>()
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 0
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (x > 0 && x + item.w > maxWidth) {
      x = 0
      y += rowHeight + GAP
      rowHeight = 0
    }
    placed.set(item.id, { x, y })
    x += item.w + GAP
    rowHeight = Math.max(rowHeight, item.h)
    width = Math.max(width, x - GAP)
  }
  return { placed, width, height: items.length ? y + rowHeight : 0 }
}

/**
 * Tidies the board: items line up in rows inside their section, sections grow
 * or shrink to fit and stop overlapping, and loose items line up where they are
 * (beside the sections if they'd land on one).
 */
export function tidyMoodboard(items: readonly MoodItemSnapshot[]): Record<string, Box> {
  const sections = items.filter((i) => i.kind === 'section').sort((a, b) => a.y - b.y || a.x - b.x)
  const others = items.filter((i) => i.kind !== 'section')
  const home = new Map(others.map((o) => [o.id, sectionOf(o, sections)]))
  const result: Record<string, Box> = {}
  const placedSections: Box[] = []

  for (const section of sections) {
    const members = others.filter((o) => home.get(o.id) === section.id)
    const inner = Math.max(section.w - 2 * SECTION_PAD, ...members.map((m) => m.w))
    const { placed, width, height } = shelf(members, inner)
    const w = Math.max(section.w, width + 2 * SECTION_PAD)
    const h = Math.max(160, SECTION_HEADER + height + SECTION_PAD)
    let y = section.y
    for (let hit = placedSections.find((p) => overlaps({ x: section.x, y, w, h }, p)); hit; hit = placedSections.find((p) => overlaps({ x: section.x, y, w, h }, p))) {
      y = hit.y + hit.h + SECTION_GAP
    }
    const box = { x: section.x, y, w, h }
    placedSections.push(box)
    result[section.id] = box
    for (const m of members) {
      const p = placed.get(m.id)!
      result[m.id] = { x: section.x + SECTION_PAD + p.x, y: y + SECTION_HEADER + p.y, w: m.w, h: m.h }
    }
  }

  const loose = others.filter((o) => home.get(o.id) === null)
  if (loose.length) {
    const left = Math.min(...loose.map((l) => l.x))
    const top = Math.min(...loose.map((l) => l.y))
    const right = Math.max(...loose.map((l) => l.x + l.w))
    const { placed, width, height } = shelf(loose, Math.max(1100, right - left))
    let origin = { x: left, y: top }
    if (placedSections.some((p) => overlaps({ x: left, y: top, w: width, h: height }, p))) {
      origin = {
        x: Math.max(...placedSections.map((p) => p.x + p.w)) + SECTION_GAP,
        y: Math.min(...placedSections.map((p) => p.y)),
      }
    }
    for (const l of loose) {
      const p = placed.get(l.id)!
      result[l.id] = { x: origin.x + p.x, y: origin.y + p.y, w: l.w, h: l.h }
    }
  }
  return result
}
