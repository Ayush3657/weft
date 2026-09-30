import { linearize, type CutItem } from './cut'
import type { AssetSnapshot, FrameSnapshot, ProjectMeta, ProjectSnapshot } from './types'

type Assets = Readonly<Record<string, AssetSnapshot>>

/** Breathing room added to VO-based durations. */
export const VO_PADDING_SECONDS = 0.5
export const MIN_AUTO_SECONDS = 1
export const MIN_SECONDS = 0.1
export const MAX_SECONDS = 3600

const round2 = (x: number) => Math.round(x * 100) / 100

export function countWords(text: string): number {
  // A word is letters/digits, optionally joined by ' ’ - (heart's, 3-bed) or, between digits, . or , (1.2, 10,000).
  const words = text.trim().match(/[\p{L}\p{N}]+(?:(?:['’-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}]+)*/gu)
  return words ? words.length : 0
}

export function voWordCount(frame: FrameSnapshot): number {
  let words = 0
  for (const line of frame.audio) words += countWords(line.text)
  return words
}

/** Seconds of speech in a frame: recorded audio where there is some, otherwise estimated from words. */
export function spokenSeconds(frame: FrameSnapshot, wordsPerSecond: number, assets?: Assets): number {
  let seconds = 0
  for (const line of frame.audio) {
    const recorded = line.assetId ? assets?.[line.assetId]?.duration : null
    if (recorded) seconds += recorded
    else if (wordsPerSecond > 0) seconds += countWords(line.text) / wordsPerSecond
  }
  return seconds
}

/** Duration from the voiceover (recorded or estimated), or the frame's own duration when nothing is spoken. */
export function autoDuration(frame: FrameSnapshot, wordsPerSecond: number, assets?: Assets): number {
  const spoken = spokenSeconds(frame, wordsPerSecond, assets)
  if (spoken <= 0) return frame.duration
  return Math.max(MIN_AUTO_SECONDS, round2(spoken + VO_PADDING_SECONDS))
}

export function baseDuration(frame: FrameSnapshot, meta: ProjectMeta, assets?: Assets): number {
  return frame.durationMode === 'manual' ? frame.duration : autoDuration(frame, meta.wordsPerSecond, assets)
}

export interface TimelineItem extends CutItem {
  start: number
  /** Seconds played in this cut (0 when hidden). */
  duration: number
  /** Duration before hiding: override if set, else the frame's own. */
  base: number
  hidden: boolean
  overridden: boolean
}

export interface Timeline {
  cutId: string
  items: TimelineItem[]
  total: number
  byFrame: ReadonlyMap<string, TimelineItem>
}

const cache = new WeakMap<ProjectSnapshot, Map<string, Timeline>>()

export function cutTimeline(s: ProjectSnapshot, cutId: string): Timeline {
  let perCut = cache.get(s)
  if (!perCut) {
    perCut = new Map()
    cache.set(s, perCut)
  }
  const cached = perCut.get(cutId)
  if (cached) return cached

  const cut = s.cuts[cutId]
  const items: TimelineItem[] = []
  const byFrame = new Map<string, TimelineItem>()
  let t = 0
  for (const item of linearize(s, cutId)) {
    const frame = s.frames[item.frameId]
    if (!frame) continue
    const override = cut?.overrides[item.frameId]
    const overridden = override !== undefined
    const base = overridden ? override : baseDuration(frame, s.meta, s.assets)
    const hidden = cut?.hidden[item.frameId] === true
    const duration = hidden ? 0 : base
    const entry: TimelineItem = { ...item, start: round2(t), duration, base, hidden, overridden }
    items.push(entry)
    byFrame.set(item.frameId, entry)
    t += duration
  }
  const timeline: Timeline = { cutId, items, total: round2(t), byFrame }
  perCut.set(cutId, timeline)
  return timeline
}

export function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SECONDS
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, round2(seconds)))
}
