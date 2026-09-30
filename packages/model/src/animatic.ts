import { cutTimeline } from './timing'
import type { CameraMove, ProjectSnapshot, TransitionType } from './types'

/**
 * What the animatic plays: the visible frames of a cut in order, and how each
 * one is entered. Shared by the Play workspace and (later) video export, so
 * both show the same thing.
 */
export interface PlayItem {
  frameId: string
  index: number
  start: number
  duration: number
  end: number
  /** How this frame is entered from the previous one (null = straight cut). */
  transitionIn: { type: RenderedTransition; duration: number } | null
}

/** Transitions drawn as such; the rest (match cut, smash cut, whip pan) play as cuts. */
export type RenderedTransition = Extract<TransitionType, 'dissolve' | 'fade-black' | 'fade-white' | 'wipe'>
const RENDERED: ReadonlySet<string> = new Set(['dissolve', 'fade-black', 'fade-white', 'wipe'])

export function playItems(s: ProjectSnapshot, cutId: string): PlayItem[] {
  const visible = cutTimeline(s, cutId).items.filter((i) => !i.hidden && i.duration > 0)
  return visible.map((item, index) => {
    const link = item.linkInId ? s.links[item.linkInId] : undefined
    const transitionIn =
      index > 0 && link && RENDERED.has(link.transition)
        ? { type: link.transition as RenderedTransition, duration: link.transitionDuration > 0 ? link.transitionDuration : 0.5 }
        : null
    return { frameId: item.frameId, index, start: item.start, duration: item.duration, end: item.start + item.duration, transitionIn }
  })
}

/** Index of the item playing at `t` (clamped to the first/last item). */
export function indexAt(items: readonly PlayItem[], t: number): number {
  if (!items.length) return -1
  let lo = 0
  let hi = items.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (items[mid]!.start <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface Layer {
  frameId: string
  opacity: number
  /** 0..1 through the frame's own time, for camera moves (held at the ends during transitions). */
  progress: number
  /** Fraction of the layer revealed from the left (wipes); 1 = all of it. */
  reveal: number
}

export interface Composition {
  current: PlayItem | null
  /** Bottom to top. */
  layers: Layer[]
  /** A solid colour over everything (fades through black or white). */
  fade: { color: 'black' | 'white'; opacity: number } | null
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const layerOf = (item: PlayItem, t: number, opacity = 1, reveal = 1): Layer => ({
  frameId: item.frameId,
  opacity,
  progress: clamp01((t - item.start) / item.duration),
  reveal,
})

/**
 * What's on screen at time `t`. A transition of length d is centred on the cut
 * point, so it overlaps d/2 into each frame and never changes the cut's length.
 */
export function composeAt(items: readonly PlayItem[], t: number): Composition {
  const i = indexAt(items, t)
  if (i < 0) return { current: null, layers: [], fade: null }
  const current = items[i]!
  const around = [
    { prev: items[i - 1], next: current },
    { prev: current, next: items[i + 1] },
  ]
  for (const { prev, next } of around) {
    if (!prev || !next?.transitionIn) continue
    const d = Math.min(next.transitionIn.duration, prev.duration, next.duration)
    if (d <= 0) continue
    const a = (t - (next.start - d / 2)) / d
    if (a < 0 || a >= 1) continue
    switch (next.transitionIn.type) {
      case 'dissolve':
        return { current, layers: [layerOf(prev, t), layerOf(next, t, a)], fade: null }
      case 'wipe':
        return { current, layers: [layerOf(prev, t), layerOf(next, t, 1, a)], fade: null }
      case 'fade-black':
      case 'fade-white': {
        const color = next.transitionIn.type === 'fade-black' ? 'black' : 'white'
        const second = a >= 0.5
        return {
          current,
          layers: [layerOf(second ? next : prev, t)],
          fade: { color, opacity: second ? 1 - (a - 0.5) * 2 : a * 2 },
        }
      }
    }
  }
  return { current, layers: [layerOf(current, t)], fade: null }
}

export interface Motion {
  /** Scale (1 = fit). */
  scale: number
  /** Offsets as fractions of the frame size. */
  x: number
  y: number
  rotate: number
}

const ease = (p: number) => p * p * (3 - 2 * p)
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const STILL: Motion = { scale: 1, x: 0, y: 0, rotate: 0 }

/**
 * A simple move on a still image that suggests the frame's camera movement,
 * so the animatic reads like previz. `progress` runs 0..1 over the frame.
 */
export function cameraMotion(move: CameraMove | null, progress: number): Motion {
  const p = ease(clamp01(progress))
  const pan = 0.045
  switch (move) {
    case 'push-in':
    case 'zoom-in':
      return { ...STILL, scale: lerp(1, 1.15, p) }
    case 'pull-out':
    case 'zoom-out':
      return { ...STILL, scale: lerp(1.15, 1, p) }
    // The camera turning left makes the picture slide right, and so on.
    case 'pan-left':
    case 'truck-left':
      return { ...STILL, scale: 1.1, x: lerp(-pan, pan, p) }
    case 'pan-right':
    case 'truck-right':
      return { ...STILL, scale: 1.1, x: lerp(pan, -pan, p) }
    case 'tilt-up':
    case 'crane-up':
      return { ...STILL, scale: 1.1, y: lerp(-pan, pan, p) }
    case 'tilt-down':
    case 'crane-down':
      return { ...STILL, scale: 1.1, y: lerp(pan, -pan, p) }
    case 'orbit':
      return { scale: lerp(1.12, 1.06, p), x: lerp(pan, -pan, p), y: 0, rotate: lerp(-1, 1, p) }
    case 'handheld': {
      const k = progress * 40
      return {
        scale: 1.05,
        x: (Math.sin(k * 1.3) + Math.sin(k * 2.9) * 0.5) * 0.004,
        y: (Math.cos(k * 1.7) + Math.sin(k * 3.7) * 0.5) * 0.004,
        rotate: Math.sin(k * 0.9) * 0.25,
      }
    }
    default:
      return STILL
  }
}

export interface AudioClip {
  key: string
  assetId: string
  /** Cut time where the clip starts. */
  start: number
  /** Seconds of the clip to play. */
  duration: number
  volume: number
}

/**
 * Recorded VO clips placed on the cut's timeline. Several lines in one frame
 * play one after another.
 */
export function voClips(s: ProjectSnapshot, items: readonly PlayItem[]): AudioClip[] {
  const clips: AudioClip[] = []
  for (const item of items) {
    const frame = s.frames[item.frameId]
    if (!frame) continue
    let offset = 0
    for (const line of frame.audio) {
      const asset = line.assetId ? s.assets[line.assetId] : undefined
      if (!asset?.duration) continue
      const duration = Math.min(asset.duration, Math.max(0, item.duration - offset))
      if (duration > 0) clips.push({ key: `${item.frameId}:${line.id}`, assetId: asset.id, start: item.start + offset, duration, volume: 1 })
      offset += asset.duration
    }
  }
  return clips
}

/** The cut's music bed as a clip, if it has one. */
export function musicClip(s: ProjectSnapshot, cutId: string): AudioClip | null {
  const music = s.cuts[cutId]?.music
  const asset = music ? s.assets[music.assetId] : undefined
  if (!music || !asset) return null
  return { key: `music:${asset.id}`, assetId: asset.id, start: music.offset, duration: asset.duration ?? 600, volume: music.volume }
}
