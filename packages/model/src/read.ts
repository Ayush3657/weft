import * as Y from 'yjs'
import {
  ASPECT_RATIOS,
  ASSET_KINDS,
  AUDIO_KINDS,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  DURATION_MODES,
  FRAME_STATUSES,
  MEDIA_SOURCES,
  PROJECT_TYPES,
  SCENE_COLORS,
  SHOT_SIZES,
  TRANSITIONS,
  BIBLE_KINDS,
  MOOD_ITEM_KINDS,
  type AssetSnapshot,
  type AudioLine,
  type BibleEntrySnapshot,
  type BriefSnapshot,
  type CutSnapshot,
  type FrameSnapshot,
  type LinkSnapshot,
  type MediaVersion,
  type MoodItemSnapshot,
  type PageSnapshot,
  type ProjectMeta,
  type ProjectSnapshot,
  type SceneSnapshot,
} from './types'

export type YMap = Y.Map<unknown>

export interface ProjectRoots {
  readonly meta: YMap
  readonly frames: Y.Map<YMap>
  readonly links: Y.Map<YMap>
  readonly cuts: Y.Map<YMap>
  readonly scenes: Y.Map<YMap>
  readonly assets: Y.Map<YMap>
  readonly bible: Y.Map<YMap>
  readonly brief: YMap
  readonly pages: Y.Map<YMap>
  readonly moodboard: Y.Map<YMap>
}

export const DEFAULT_WORDS_PER_SECOND = 2.5
export const DEFAULT_FRAME_SECONDS = 3

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
export const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
export const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)
export const text = (v: unknown): string => (v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v : '')

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function optOneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
}

const ids = <T extends { id: string }>(options: readonly T[]): T['id'][] => options.map((o) => o.id)
const SHOT_SIZE_IDS = ids(SHOT_SIZES)
const ANGLE_IDS = ids(CAMERA_ANGLES)
const MOVE_IDS = ids(CAMERA_MOVES)
const TRANSITION_IDS = ids(TRANSITIONS)

function strings(v: unknown): string[] {
  return v instanceof Y.Array ? v.toArray().filter((x): x is string => typeof x === 'string') : []
}

function record<T>(v: unknown, guard: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {}
  if (v instanceof Y.Map) for (const [k, x] of v.entries()) if (guard(x)) out[k] = x
  return out
}

const isString = (x: unknown): x is string => typeof x === 'string'
const isTrue = (x: unknown): x is boolean => x === true
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function readMeta(m: YMap): ProjectMeta {
  return {
    schemaVersion: num(m.get('schemaVersion')),
    title: str(m.get('title')),
    type: oneOf(m.get('type'), PROJECT_TYPES, 'ad'),
    aspect: oneOf(m.get('aspect'), ASPECT_RATIOS, '16:9'),
    fps: num(m.get('fps'), 25),
    targetDuration: optNum(m.get('targetDuration')),
    wordsPerSecond: num(m.get('wordsPerSecond'), DEFAULT_WORDS_PER_SECOND),
    mainCutId: str(m.get('mainCutId')),
    autoLayout: bool(m.get('autoLayout'), true),
  }
}

export function readAudioLine(m: YMap): AudioLine {
  return {
    id: str(m.get('id')),
    kind: oneOf(m.get('kind'), AUDIO_KINDS, 'vo'),
    speaker: str(m.get('speaker')),
    text: text(m.get('text')),
    lang: str(m.get('lang'), 'en'),
    assetId: optStr(m.get('assetId')),
  }
}

function readMedia(v: unknown): MediaVersion[] {
  if (!(v instanceof Y.Array)) return []
  const out: MediaVersion[] = []
  for (const x of v.toArray()) {
    if (x && typeof x === 'object' && typeof x.id === 'string' && typeof x.assetId === 'string') {
      out.push({
        id: x.id,
        assetId: x.assetId,
        createdAt: num(x.createdAt),
        source: oneOf(x.source, MEDIA_SOURCES, 'upload'),
        label: str(x.label),
      })
    }
  }
  return out
}

export function readFrame(m: YMap): FrameSnapshot {
  const audio = m.get('audio')
  return {
    id: str(m.get('id')),
    createdAt: num(m.get('createdAt')),
    x: num(m.get('x')),
    y: num(m.get('y')),
    sceneId: optStr(m.get('sceneId')),
    description: text(m.get('description')),
    onScreenText: text(m.get('onScreenText')),
    motionNotes: text(m.get('motionNotes')),
    notes: text(m.get('notes')),
    audio:
      audio instanceof Y.Array
        ? audio.toArray().flatMap((line) => (line instanceof Y.Map ? [readAudioLine(line as YMap)] : []))
        : [],
    shotSize: optOneOf(m.get('shotSize'), SHOT_SIZE_IDS),
    angle: optOneOf(m.get('angle'), ANGLE_IDS),
    movement: optOneOf(m.get('movement'), MOVE_IDS),
    lens: optStr(m.get('lens')),
    durationMode: oneOf(m.get('durationMode'), DURATION_MODES, 'auto'),
    duration: num(m.get('duration'), DEFAULT_FRAME_SECONDS),
    media: readMedia(m.get('media')),
    heroMediaId: optStr(m.get('heroMediaId')),
    references: strings(m.get('references')),
    tags: strings(m.get('tags')),
    status: oneOf(m.get('status'), FRAME_STATUSES, 'draft'),
  }
}

export function readLink(m: YMap): LinkSnapshot {
  return {
    id: str(m.get('id')),
    from: str(m.get('from')),
    to: str(m.get('to')),
    createdAt: num(m.get('createdAt')),
    transition: oneOf(m.get('transition'), TRANSITION_IDS, 'cut'),
    transitionDuration: num(m.get('transitionDuration')),
    note: str(m.get('note')),
  }
}

export function readCut(m: YMap): CutSnapshot {
  return {
    id: str(m.get('id')),
    name: str(m.get('name'), 'Untitled cut'),
    createdAt: num(m.get('createdAt')),
    isMain: bool(m.get('isMain')),
    targetDuration: optNum(m.get('targetDuration')),
    start: optStr(m.get('start')),
    choices: record(m.get('choices'), isString),
    hidden: record(m.get('hidden'), isTrue),
    overrides: record(m.get('overrides'), isNumber),
    music: readMusic(m),
    beats: readBeats(m.get('beats')),
  }
}

function readMusic(m: YMap): CutSnapshot['music'] {
  const assetId = optStr(m.get('musicAssetId'))
  if (!assetId) return null
  return { assetId, offset: num(m.get('musicOffset')), volume: num(m.get('musicVolume'), 0.8) }
}

function readBeats(v: unknown): number[] {
  if (!(v instanceof Y.Array)) return []
  return v
    .toArray()
    .filter(isNumber)
    .sort((a, b) => a - b)
}

export function readScene(m: YMap): SceneSnapshot {
  return {
    id: str(m.get('id')),
    title: str(m.get('title')),
    createdAt: num(m.get('createdAt')),
    intExt: str(m.get('intExt')),
    location: str(m.get('location')),
    timeOfDay: str(m.get('timeOfDay')),
    color: oneOf(m.get('color'), SCENE_COLORS, 'violet'),
  }
}

export function readAsset(m: YMap): AssetSnapshot {
  return {
    id: str(m.get('id')),
    kind: oneOf(m.get('kind'), ASSET_KINDS, 'image'),
    hash: optStr(m.get('hash')),
    name: str(m.get('name')),
    mime: str(m.get('mime')),
    size: num(m.get('size')),
    width: optNum(m.get('width')),
    height: optNum(m.get('height')),
    duration: optNum(m.get('duration')),
    url: optStr(m.get('url')),
    title: str(m.get('title')),
    preview: optStr(m.get('preview')),
    site: str(m.get('site')),
    createdAt: num(m.get('createdAt')),
    createdBy: optStr(m.get('createdBy')),
  }
}

export function readBibleEntry(m: YMap): BibleEntrySnapshot {
  return {
    id: str(m.get('id')),
    kind: oneOf(m.get('kind'), BIBLE_KINDS, 'character'),
    name: str(m.get('name')),
    description: text(m.get('description')),
    assetIds: strings(m.get('assetIds')),
    createdAt: num(m.get('createdAt')),
  }
}

export function readBrief(m: YMap): BriefSnapshot {
  return {
    logline: text(m.get('logline')),
    audience: text(m.get('audience')),
    tone: text(m.get('tone')),
    styleRefs: strings(m.get('styleRefs')),
  }
}

export function readPage(m: YMap): PageSnapshot {
  return { id: str(m.get('id')), title: str(m.get('title')), createdAt: num(m.get('createdAt')) }
}

export function readMoodItem(m: YMap): MoodItemSnapshot {
  return {
    id: str(m.get('id')),
    kind: oneOf(m.get('kind'), MOOD_ITEM_KINDS, 'note'),
    assetId: optStr(m.get('assetId')),
    text: text(m.get('text')),
    color: str(m.get('color'), '#f2c14e'),
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: num(m.get('w'), 240),
    h: num(m.get('h'), 180),
    createdAt: num(m.get('createdAt')),
  }
}

function readAll<T>(map: Y.Map<YMap>, read: (m: YMap) => T): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, m] of map.entries()) if (m instanceof Y.Map) out[id] = read(m)
  return out
}

export function buildSnapshot(r: ProjectRoots): ProjectSnapshot {
  return {
    meta: readMeta(r.meta),
    frames: readAll(r.frames, readFrame),
    links: readAll(r.links, readLink),
    cuts: readAll(r.cuts, readCut),
    scenes: readAll(r.scenes, readScene),
    assets: readAll(r.assets, readAsset),
    bible: readAll(r.bible, readBibleEntry),
    brief: readBrief(r.brief),
    pages: readAll(r.pages, readPage),
    moodboard: readAll(r.moodboard, readMoodItem),
  }
}
