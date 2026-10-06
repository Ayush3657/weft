import { formatDuration, formatSeconds } from './format'
import { shotLabels } from './numbering'
import { cutTimeline } from './timing'
import {
  CAMERA_ANGLES,
  CAMERA_MOVES,
  SHOT_SIZES,
  TRANSITIONS,
  findOption,
  type AssetSnapshot,
  type FrameSnapshot,
  type ProjectSnapshot,
} from './types'

/**
 * Readable copies of a project, for a project's folder on disk (project.json,
 * script.md, notes/*.md, media/) and for exports. Weft itself reopens a folder
 * from project.sync, the exact sync state; these are for people and other tools.
 */

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
}

/** A file or folder name that works on Windows, macOS and Linux. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  const out = cleaned || fallback
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out) ? `${out}_` : out
}

/** An asset's file name in a project folder: readable, plus the start of its hash so names never clash. */
export function mediaFileName(asset: AssetSnapshot): string | null {
  if (!asset.hash) return null
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(asset.name)?.[1]?.toLowerCase()
  const ext = EXTENSIONS[asset.mime] ?? fromName ?? 'bin'
  const base = safeFileName((asset.title || asset.name || asset.kind).replace(/\.[a-z0-9]{2,5}$/i, ''), asset.kind).slice(0, 60)
  return `${base}-${asset.hash.slice(0, 10)}.${ext}`
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
const cell = (text: string) => flat(text).replace(/\|/g, '\\|') || ' '

function audioLines(f: FrameSnapshot): string[] {
  return f.audio
    .filter((l) => l.text.trim() || l.assetId)
    .map((l) => {
      const who = l.kind === 'vo' ? (l.speaker ? `VO (${l.speaker})` : 'VO') : l.speaker || 'Dialogue'
      return `${who}: ${flat(l.text) || '(recorded, no script)'}${l.assetId ? ' [recorded]' : ''}`
    })
}

/** A cut as an AV script: a Markdown table of video, audio, on-screen text and length. */
export function scriptMarkdown(s: ProjectSnapshot, cutId: string): string {
  const cut = s.cuts[cutId]
  if (!cut) return ''
  const t = cutTimeline(s, cutId)
  const labels = shotLabels(s)
  const rows = t.items.map((item) => {
    const f = s.frames[item.frameId]!
    return `| ${labels.get(f.id) ?? ''} | ${cell(f.description)} | ${cell(audioLines(f).join(' / '))} | ${cell(f.onScreenText)} | ${item.hidden ? 'hidden' : formatDuration(item.duration)} |`
  })
  return [
    `AV script · "${cut.name}" · ${formatSeconds(t.total)}${cut.targetDuration ? ` of ${formatSeconds(cut.targetDuration)}` : ''}`,
    '',
    '| Shot | Video | Audio | On screen | Length |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

/** Every cut's AV script, main cut first. */
export function scriptsMarkdown(s: ProjectSnapshot): string {
  const cuts = Object.values(s.cuts).sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : a.createdAt - b.createdAt))
  return `# ${s.meta.title || 'Untitled'}\n\n${cuts.map((c) => `## ${scriptMarkdown(s, c.id)}`).join('\n\n')}\n`
}

export interface NotesPage {
  id: string
  title: string
  markdown: string
}

/** What project.json holds. */
/** Where a project lives in Weft: its space and folders, by name and id. */
export interface ProjectPlace {
  space: string
  spaceId: string
  folders: string[]
  folderId: string | null
}

export interface ProjectExport {
  weft: 1
  projectId: string
  title: string
  /** Where it lives in Weft, so a folder brought back in can go home. */
  place?: ProjectPlace
  /** Left out of a project folder's copy: the file's own date says when it was saved. */
  savedAt?: string
  type: string
  aspect: string
  fps: number
  wordsPerSecond: number
  brief: { idea: string; audience: string; tone: string; styleReferences: string[] }
  bible: Array<{ id: string; kind: string; name: string; description: string; pictures: string[] }>
  cuts: Array<{
    id: string
    name: string
    main: boolean
    targetSeconds: number | null
    lengthSeconds: number
    shots: Array<{ shot: string; frame: string; startSeconds: number; seconds: number; hidden: boolean; lengthSetForThisCut: boolean }>
  }>
  frames: Array<{
    id: string
    shot: string | null
    description: string
    audio: Array<{ kind: string; speaker: string; text: string; recording: string | null }>
    onScreenText: string
    camera: { shot: string | null; angle: string | null; movement: string | null; lens: string | null }
    seconds: number
    lengthFrom: 'voiceover' | 'manual'
    inShot: string[]
    scene: string | null
    status: string
    picture: string | null
    pictureVersions: string[]
    references: string[]
    notes: string
    motionNotes: string
  }>
  links: Array<{ from: string; to: string; transition: string; seconds: number; note: string }>
  scenes: Array<{ id: string; title: string; intExt: string; location: string; timeOfDay: string }>
  notes: Array<{ title: string; markdown: string }>
  moodboard: Array<{ kind: string; text: string; color: string; file: string | null; link: string | null; x: number; y: number; w: number; h: number }>
  media: Array<{ file: string; kind: string; name: string; hash: string; mime: string; width: number | null; height: number | null; seconds: number | null }>
  webLinks: Array<{ url: string; title: string; site: string }>
}

/** A readable snapshot of the whole project. Media is referred to by its file in media/. */
export function exportProject(
  s: ProjectSnapshot,
  opts: { projectId: string; notes: readonly NotesPage[]; savedAt?: number; place?: ProjectPlace | null },
): ProjectExport {
  const labels = shotLabels(s)
  const file = (assetId: string | null | undefined) => {
    const a = assetId ? s.assets[assetId] : undefined
    const name = a ? mediaFileName(a) : null
    return name ? `media/${name}` : null
  }
  const files = (ids: readonly string[]) => ids.map(file).filter((f): f is string => f !== null)
  const byCreation = <T extends { createdAt: number }>(list: T[]) => list.sort((a, b) => a.createdAt - b.createdAt)

  return {
    weft: 1,
    projectId: opts.projectId,
    title: s.meta.title,
    ...(opts.place ? { place: opts.place } : {}),
    ...(opts.savedAt ? { savedAt: new Date(opts.savedAt).toISOString() } : {}),
    type: s.meta.type,
    aspect: s.meta.aspect,
    fps: s.meta.fps,
    wordsPerSecond: s.meta.wordsPerSecond,
    brief: { idea: s.brief.logline, audience: s.brief.audience, tone: s.brief.tone, styleReferences: files(s.brief.styleRefs) },
    bible: byCreation(Object.values(s.bible)).map((e) => ({ id: e.id, kind: e.kind, name: e.name, description: e.description, pictures: files(e.assetIds) })),
    cuts: Object.values(s.cuts)
      .sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : a.createdAt - b.createdAt))
      .map((c) => {
        const t = cutTimeline(s, c.id)
        return {
          id: c.id,
          name: c.name,
          main: c.isMain,
          targetSeconds: c.targetDuration,
          lengthSeconds: Math.round(t.total * 100) / 100,
          shots: t.items.map((i) => ({
            shot: labels.get(i.frameId) ?? '',
            frame: i.frameId,
            startSeconds: Math.round(i.start * 100) / 100,
            seconds: Math.round(i.duration * 100) / 100,
            hidden: i.hidden,
            lengthSetForThisCut: i.overridden,
          })),
        }
      }),
    frames: byCreation(Object.values(s.frames)).map((f) => {
      const hero = f.media.find((m) => m.id === f.heroMediaId)
      return {
        id: f.id,
        shot: labels.get(f.id) ?? null,
        description: f.description,
        audio: f.audio.map((l) => ({ kind: l.kind, speaker: l.speaker, text: l.text, recording: file(l.assetId) })),
        onScreenText: f.onScreenText,
        camera: {
          shot: findOption(SHOT_SIZES, f.shotSize)?.label ?? null,
          angle: findOption(CAMERA_ANGLES, f.angle)?.label ?? null,
          movement: findOption(CAMERA_MOVES, f.movement)?.label ?? null,
          lens: f.lens,
        },
        seconds: f.duration,
        lengthFrom: f.durationMode === 'manual' ? 'manual' : 'voiceover',
        inShot: f.tags.map((id) => s.bible[id]?.name).filter((n): n is string => !!n),
        scene: f.sceneId ? (s.scenes[f.sceneId]?.title ?? null) : null,
        status: f.status,
        picture: file(hero?.assetId),
        pictureVersions: files(f.media.map((m) => m.assetId)),
        references: files(f.references),
        notes: f.notes,
        motionNotes: f.motionNotes,
      }
    }),
    links: Object.values(s.links).map((l) => ({
      from: l.from,
      to: l.to,
      transition: findOption(TRANSITIONS, l.transition)?.label ?? l.transition,
      seconds: l.transitionDuration,
      note: l.note,
    })),
    scenes: byCreation(Object.values(s.scenes)).map((sc) => ({ id: sc.id, title: sc.title, intExt: sc.intExt, location: sc.location, timeOfDay: sc.timeOfDay })),
    notes: opts.notes.map((p) => ({ title: p.title, markdown: p.markdown })),
    moodboard: byCreation(Object.values(s.moodboard)).map((i) => {
      const a = i.assetId ? s.assets[i.assetId] : undefined
      return { kind: i.kind, text: i.text, color: i.color, file: file(i.assetId), link: a?.kind === 'link' ? a.url : null, x: i.x, y: i.y, w: i.w, h: i.h }
    }),
    media: byCreation(Object.values(s.assets))
      .filter((a) => a.hash)
      .map((a) => ({
        file: `media/${mediaFileName(a)}`,
        kind: a.kind,
        name: a.name,
        hash: a.hash!,
        mime: a.mime,
        width: a.width,
        height: a.height,
        seconds: a.duration,
      })),
    webLinks: Object.values(s.assets)
      .filter((a) => a.kind === 'link' && a.url)
      .map((a) => ({ url: a.url!, title: a.title, site: a.site })),
  }
}
