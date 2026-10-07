import { shotLabels } from './numbering'
import { cutTimeline } from './timing'
import { CAMERA_ANGLES, SHOT_SIZES, findOption, type AspectRatio, type CameraMove, type ProjectSnapshot } from './types'

/**
 * Prompts for AI video generation, written from what a frame already says:
 * its description, camera, length, who and what is in it (from the bible),
 * its dialogue, and the brief's tone. Each tool wants them a little
 * differently.
 */

export type VideoTarget = 'flow' | 'higgsfield' | 'generic'

export const VIDEO_TARGETS: ReadonlyArray<{ id: VideoTarget; label: string; hint: string }> = [
  { id: 'flow', label: 'Google Flow', hint: 'Veo: text or a start frame to video, with sound and dialogue' },
  { id: 'higgsfield', label: 'Higgsfield', hint: 'A start frame to video, with a camera-move preset' },
  { id: 'generic', label: 'Other tools', hint: 'Kling, Runway, Sora, or a model on your computer (Wan, Hunyuan…)' },
]

export interface VideoPromptOptions {
  target: VideoTarget
  /** Spoken lines, for tools that make sound (Flow). */
  dialogue?: boolean
  /** Voice-over lines, read by a narrator (Flow). Usually recorded separately instead. */
  voiceover?: boolean
  /** The brief's tone. */
  tone?: boolean
}

export interface VideoPrompt {
  frameId: string
  /** Its shot number in the cut. */
  shot: string | null
  prompt: string
  /** What to keep out, for tools that take a negative prompt. */
  negative: string | null
  /** Higgsfield's camera-move preset for the frame's movement. */
  preset: string | null
  seconds: number
  aspect: AspectRatio
  /** The frame's picture (an asset id), to start the video from. */
  startFrame: string | null
}

const MOVES: Record<CameraMove, string> = {
  static: 'The camera holds still.',
  'push-in': 'The camera slowly pushes in.',
  'pull-out': 'The camera slowly pulls back.',
  'pan-left': 'The camera pans left.',
  'pan-right': 'The camera pans right.',
  'tilt-up': 'The camera tilts up.',
  'tilt-down': 'The camera tilts down.',
  'truck-left': 'The camera tracks left.',
  'truck-right': 'The camera tracks right.',
  'crane-up': 'The camera cranes up.',
  'crane-down': 'The camera cranes down.',
  orbit: 'The camera arcs around the subject.',
  handheld: 'Handheld camera, with a slight natural sway.',
  'zoom-in': 'The lens slowly zooms in.',
  'zoom-out': 'The lens slowly zooms out.',
}

/** Higgsfield's preset closest to each camera move. */
const HIGGSFIELD: Record<CameraMove, string> = {
  static: 'Static',
  'push-in': 'Dolly In',
  'pull-out': 'Dolly Out',
  'pan-left': 'Dolly Left',
  'pan-right': 'Dolly Right',
  'tilt-up': 'Tilt Up',
  'tilt-down': 'Tilt Down',
  'truck-left': 'Dolly Left',
  'truck-right': 'Dolly Right',
  'crane-up': 'Crane Up',
  'crane-down': 'Crane Down',
  orbit: 'Arc Right',
  handheld: 'Handheld',
  'zoom-in': 'Zoom In',
  'zoom-out': 'Zoom Out',
}

const NEGATIVE = 'text, subtitles, captions, watermark, logo, distorted faces, extra fingers, warped architecture, blurry, low quality'

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
const sentence = (text: string) => {
  const t = flat(text)
  return !t ? '' : /[.!?…"”]$/.test(t) ? t : `${t}.`
}
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text)

/** The prompt for one frame, for one tool. */
export function videoPrompt(s: ProjectSnapshot, frameId: string, cutId: string, options: VideoPromptOptions): VideoPrompt {
  const f = s.frames[frameId]
  if (!f) throw new Error(`No frame ${frameId}`)
  const item = cutTimeline(s, cutId).byFrame.get(frameId)
  const seconds = Math.round((item?.duration ?? f.duration) * 10) / 10

  const size = findOption(SHOT_SIZES, f.shotSize)?.label
  const angle = f.angle && f.angle !== 'eye' ? findOption(CAMERA_ANGLES, f.angle)?.label.toLowerCase() : null
  const camera = [size ? `${size} shot` : null, angle, f.lens?.trim() ? `on a ${f.lens.trim()} lens` : null].filter(Boolean).join(', ')

  // Who and what is in the shot, as the bible describes them, so each shot keeps them the same.
  const cast = f.tags
    .map((id) => s.bible[id])
    .filter((e) => !!e)
    .map((e) => (e.description.trim() ? `${e.name} (${clip(flat(e.description), 220)})` : e.name))
  const lines = f.audio.filter((l) => l.text.trim())
  const spoken =
    options.target === 'flow'
      ? [
          ...(options.dialogue === false ? [] : lines.filter((l) => l.kind === 'dialogue').map((l) => `${l.speaker.trim() || 'Someone'} says: "${flat(l.text)}"`)),
          ...(options.voiceover ? lines.filter((l) => l.kind === 'vo').map((l) => `Voice-over${l.speaker.trim() ? ` (${l.speaker.trim()})` : ''}: "${flat(l.text)}"`) : []),
        ]
      : []
  const tone = options.tone === false ? '' : flat(s.brief.tone)
  const move = f.movement ? MOVES[f.movement] : ''

  const parts =
    options.target === 'higgsfield'
      ? // The preset carries the camera move; the prompt says what happens.
        [sentence(f.description), cast.length ? sentence(`In the shot: ${cast.join('; ')}`) : '', camera ? sentence(`Framing: ${camera}`) : '', tone ? sentence(`Mood: ${tone}`) : '']
      : [
          camera ? sentence(camera.charAt(0).toUpperCase() + camera.slice(1)) : '',
          sentence(f.description),
          cast.length ? sentence(`In the shot: ${cast.join('; ')}`) : '',
          move,
          tone ? sentence(`Tone and look: ${tone}`) : '',
          ...spoken.map(sentence),
          options.target === 'flow' ? (spoken.length ? 'Audio: the voices, with natural ambient sound; no music.' : 'Audio: natural ambient sound; no music, no narration.') : '',
          options.target === 'flow' ? 'No subtitles or on-screen text.' : '',
          options.target === 'generic' ? `${seconds} seconds, ${s.meta.aspect}.` : '',
        ]
  const hero = f.media.find((m) => m.id === f.heroMediaId)
  const heroAsset = hero ? s.assets[hero.assetId] : undefined
  return {
    frameId,
    shot: shotLabels(s).get(frameId) ?? null,
    prompt: parts.filter(Boolean).join(' ') || '(Describe the shot first: the frame has no description yet.)',
    negative: options.target === 'generic' ? NEGATIVE : null,
    preset: options.target === 'higgsfield' ? (f.movement ? HIGGSFIELD[f.movement] : 'General') : null,
    seconds,
    aspect: s.meta.aspect,
    startFrame: heroAsset?.kind === 'image' ? heroAsset.id : null,
  }
}

/** Prompts for every shot in a cut, in order (hidden shots left out). */
export function videoPrompts(s: ProjectSnapshot, cutId: string, options: VideoPromptOptions): VideoPrompt[] {
  return cutTimeline(s, cutId)
    .items.filter((i) => !i.hidden)
    .map((i) => videoPrompt(s, i.frameId, cutId, options))
}

/** A cut's prompts as one text, numbered by shot, ready to paste. */
export function videoPromptsText(prompts: readonly VideoPrompt[]): string {
  return prompts
    .map((p) =>
      [
        `Shot ${p.shot ?? '?'} (${p.seconds}s)${p.preset ? ` · camera preset: ${p.preset}` : ''}`,
        p.prompt,
        ...(p.negative ? [`Negative: ${p.negative}`] : []),
      ].join('\n'),
    )
    .join('\n\n')
}
