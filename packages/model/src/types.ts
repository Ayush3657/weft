export type ProjectType = 'ad' | 'film' | 'other'
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '2.39:1'
export type DurationMode = 'auto' | 'manual'
export type FrameStatus = 'idea' | 'draft' | 'approved'
export type AudioKind = 'vo' | 'dialogue'
export type AssetKind = 'image' | 'video' | 'audio' | 'link'
export type MediaSource = 'upload' | 'paste' | 'sketch' | 'ai' | 'link'

export const PROJECT_TYPES: readonly ProjectType[] = ['ad', 'film', 'other']
export const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:5', '2.39:1']
export const DURATION_MODES: readonly DurationMode[] = ['auto', 'manual']
export const FRAME_STATUSES: readonly FrameStatus[] = ['idea', 'draft', 'approved']
export const AUDIO_KINDS: readonly AudioKind[] = ['vo', 'dialogue']
export const ASSET_KINDS: readonly AssetKind[] = ['image', 'video', 'audio', 'link']
export const MEDIA_SOURCES: readonly MediaSource[] = ['upload', 'paste', 'sketch', 'ai', 'link']

/** Width divided by height. */
export function aspectValue(aspect: AspectRatio): number {
  switch (aspect) {
    case '16:9':
      return 16 / 9
    case '9:16':
      return 9 / 16
    case '1:1':
      return 1
    case '4:5':
      return 4 / 5
    case '2.39:1':
      return 2.39
  }
}

export interface Option {
  readonly id: string
  readonly label: string
  readonly short: string
}

export const SHOT_SIZES = [
  { id: 'ews', label: 'Extreme wide', short: 'EWS' },
  { id: 'ws', label: 'Wide', short: 'WS' },
  { id: 'ms', label: 'Medium', short: 'MS' },
  { id: 'mcu', label: 'Medium close-up', short: 'MCU' },
  { id: 'cu', label: 'Close-up', short: 'CU' },
  { id: 'ecu', label: 'Extreme close-up', short: 'ECU' },
  { id: 'insert', label: 'Insert', short: 'INS' },
] as const satisfies readonly Option[]

export const CAMERA_ANGLES = [
  { id: 'eye', label: 'Eye level', short: 'Eye' },
  { id: 'high', label: 'High angle', short: 'High' },
  { id: 'low', label: 'Low angle', short: 'Low' },
  { id: 'overhead', label: 'Overhead', short: 'Top' },
  { id: 'dutch', label: 'Dutch angle', short: 'Dutch' },
  { id: 'ots', label: 'Over the shoulder', short: 'OTS' },
  { id: 'pov', label: 'Point of view', short: 'POV' },
] as const satisfies readonly Option[]

export const CAMERA_MOVES = [
  { id: 'static', label: 'Static', short: 'Static' },
  { id: 'push-in', label: 'Push in', short: 'Push in' },
  { id: 'pull-out', label: 'Pull out', short: 'Pull out' },
  { id: 'pan-left', label: 'Pan left', short: 'Pan L' },
  { id: 'pan-right', label: 'Pan right', short: 'Pan R' },
  { id: 'tilt-up', label: 'Tilt up', short: 'Tilt up' },
  { id: 'tilt-down', label: 'Tilt down', short: 'Tilt down' },
  { id: 'truck-left', label: 'Truck left', short: 'Truck L' },
  { id: 'truck-right', label: 'Truck right', short: 'Truck R' },
  { id: 'crane-up', label: 'Crane up', short: 'Crane up' },
  { id: 'crane-down', label: 'Crane down', short: 'Crane down' },
  { id: 'orbit', label: 'Orbit', short: 'Orbit' },
  { id: 'handheld', label: 'Handheld', short: 'Handheld' },
  { id: 'zoom-in', label: 'Zoom in', short: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out', short: 'Zoom out' },
] as const satisfies readonly Option[]

export const TRANSITIONS = [
  { id: 'cut', label: 'Cut', short: 'Cut' },
  { id: 'dissolve', label: 'Dissolve', short: 'Dissolve' },
  { id: 'fade-black', label: 'Fade through black', short: 'Fade' },
  { id: 'fade-white', label: 'Fade through white', short: 'Dip to white' },
  { id: 'wipe', label: 'Wipe', short: 'Wipe' },
  { id: 'match-cut', label: 'Match cut', short: 'Match cut' },
  { id: 'whip-pan', label: 'Whip pan', short: 'Whip pan' },
  { id: 'smash-cut', label: 'Smash cut', short: 'Smash cut' },
] as const satisfies readonly Option[]

export const SCENE_COLORS = ['violet', 'teal', 'coral', 'amber', 'blue', 'pink', 'green', 'gray'] as const

export type ShotSize = (typeof SHOT_SIZES)[number]['id']
export type CameraAngle = (typeof CAMERA_ANGLES)[number]['id']
export type CameraMove = (typeof CAMERA_MOVES)[number]['id']
export type TransitionType = (typeof TRANSITIONS)[number]['id']
export type SceneColor = (typeof SCENE_COLORS)[number]

export function findOption<T extends Option>(options: readonly T[], id: string | null | undefined): T | undefined {
  return id ? options.find((o) => o.id === id) : undefined
}

export interface ProjectMeta {
  schemaVersion: number
  title: string
  type: ProjectType
  aspect: AspectRatio
  fps: number
  targetDuration: number | null
  wordsPerSecond: number
  mainCutId: string
  autoLayout: boolean
}

export interface AudioLine {
  id: string
  kind: AudioKind
  speaker: string
  text: string
  lang: string
  /** Recorded or generated audio for this line. */
  assetId: string | null
}

export interface MediaVersion {
  id: string
  assetId: string
  createdAt: number
  source: MediaSource
  label: string
}

export interface FrameSnapshot {
  id: string
  createdAt: number
  x: number
  y: number
  sceneId: string | null
  description: string
  onScreenText: string
  motionNotes: string
  notes: string
  audio: AudioLine[]
  shotSize: ShotSize | null
  angle: CameraAngle | null
  movement: CameraMove | null
  lens: string | null
  durationMode: DurationMode
  /** Manual duration in seconds; also the fallback for auto mode when there's no VO. */
  duration: number
  media: MediaVersion[]
  heroMediaId: string | null
  references: string[]
  tags: string[]
  status: FrameStatus
}

export interface LinkSnapshot {
  id: string
  from: string
  to: string
  createdAt: number
  transition: TransitionType
  transitionDuration: number
  note: string
}

export interface CutSnapshot {
  id: string
  name: string
  createdAt: number
  isMain: boolean
  targetDuration: number | null
  /** Frame the cut starts from; null means "pick the natural start". */
  start: string | null
  /** Fork frame id -> id of the outgoing link this cut follows. */
  choices: Record<string, string>
  hidden: Record<string, boolean>
  /** Frame id -> duration in seconds, for this cut only. */
  overrides: Record<string, number>
  /** Music bed for this cut; `offset` is where in the cut the track starts (seconds). */
  music: { assetId: string; offset: number; volume: number } | null
  /** Beat markers in seconds, sorted. */
  beats: number[]
}

export interface SceneSnapshot {
  id: string
  title: string
  createdAt: number
  intExt: string
  location: string
  timeOfDay: string
  color: SceneColor
}

export interface AssetSnapshot {
  id: string
  kind: AssetKind
  /** SHA-256 of the file contents (null for links). */
  hash: string | null
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  url: string | null
  title: string
  /** Links: preview image (remote URL) and site name, from the page's metadata. */
  preview: string | null
  site: string
  createdAt: number
  createdBy: string | null
}

export type BibleKind = 'character' | 'location' | 'product'
export const BIBLE_KINDS: readonly BibleKind[] = ['character', 'location', 'product']

export interface BibleEntrySnapshot {
  id: string
  kind: BibleKind
  name: string
  description: string
  assetIds: string[]
  createdAt: number
}

export interface BriefSnapshot {
  logline: string
  audience: string
  tone: string
  styleRefs: string[]
}

export interface PageSnapshot {
  id: string
  title: string
  createdAt: number
}

export type MoodItemKind = 'asset' | 'note' | 'color' | 'section'
export const MOOD_ITEM_KINDS: readonly MoodItemKind[] = ['asset', 'note', 'color', 'section']

export interface MoodItemSnapshot {
  id: string
  kind: MoodItemKind
  assetId: string | null
  /** Notes: the note's text. Sections: their title. */
  text: string
  /** Colour swatches and notes: a hex colour. */
  color: string
  x: number
  y: number
  w: number
  h: number
  createdAt: number
}

export interface ProjectSnapshot {
  meta: ProjectMeta
  frames: Readonly<Record<string, FrameSnapshot>>
  links: Readonly<Record<string, LinkSnapshot>>
  cuts: Readonly<Record<string, CutSnapshot>>
  scenes: Readonly<Record<string, SceneSnapshot>>
  assets: Readonly<Record<string, AssetSnapshot>>
  bible: Readonly<Record<string, BibleEntrySnapshot>>
  brief: BriefSnapshot
  pages: Readonly<Record<string, PageSnapshot>>
  moodboard: Readonly<Record<string, MoodItemSnapshot>>
}
