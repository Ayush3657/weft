import * as Y from 'yjs'
import { linearize } from './cut'
import { WeftError } from './errors'
import { byCreation } from './graph'
import { newId, timestamp } from './ids'
import { DEFAULT_FRAME_SECONDS, buildSnapshot, num, readFrame, readLink, readMeta, str, type ProjectRoots, type YMap } from './read'
import { applyTextDiff } from './text'
import { clampSeconds } from './timing'
import type {
  AspectRatio,
  AssetKind,
  AudioKind,
  BibleKind,
  MoodItemKind,
  CameraAngle,
  CameraMove,
  DurationMode,
  FrameSnapshot,
  FrameStatus,
  LinkSnapshot,
  MediaSource,
  MediaVersion,
  ProjectMeta,
  ProjectSnapshot,
  ProjectType,
  SceneColor,
  ShotSize,
  TransitionType,
} from './types'

export const TEXT_FIELDS = ['description', 'onScreenText', 'motionNotes', 'notes'] as const
export type TextField = (typeof TEXT_FIELDS)[number]

/** Spacing for frames placed by commands. Auto-layout replaces these positions. */
export const FRAME_SPACING_X = 300
export const FRAME_SPACING_Y = 280

export interface AudioLineInit {
  kind?: AudioKind
  speaker?: string
  text?: string
  lang?: string
  assetId?: string | null
}

export interface FrameInit {
  x?: number
  y?: number
  sceneId?: string | null
  description?: string
  onScreenText?: string
  motionNotes?: string
  notes?: string
  audio?: AudioLineInit[]
  shotSize?: ShotSize | null
  angle?: CameraAngle | null
  movement?: CameraMove | null
  lens?: string | null
  durationMode?: DurationMode
  duration?: number
  references?: string[]
  tags?: string[]
  status?: FrameStatus
}

export interface FramePatch {
  x?: number
  y?: number
  sceneId?: string | null
  shotSize?: ShotSize | null
  angle?: CameraAngle | null
  movement?: CameraMove | null
  lens?: string | null
  durationMode?: DurationMode
  duration?: number
  status?: FrameStatus
}

const FRAME_PATCH_KEYS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'sceneId',
  'shotSize',
  'angle',
  'movement',
  'lens',
  'durationMode',
  'duration',
  'status',
])

export interface LinkPatch {
  transition?: TransitionType
  transitionDuration?: number
  note?: string
}

export interface ScenePatch {
  title?: string
  intExt?: string
  location?: string
  timeOfDay?: string
  color?: SceneColor
}

export interface AssetInit {
  kind: AssetKind
  hash?: string | null
  name?: string
  mime?: string
  size?: number
  width?: number | null
  height?: number | null
  duration?: number | null
  url?: string | null
  title?: string
  preview?: string | null
  site?: string
  createdBy?: string | null
}

export type BriefField = 'logline' | 'audience' | 'tone'

export interface MoodItemInit {
  kind: MoodItemKind
  assetId?: string | null
  text?: string
  color?: string
  x: number
  y: number
  w?: number
  h?: number
}

export type MetaPatch = Partial<{
  title: string
  type: ProjectType
  aspect: AspectRatio
  fps: number
  targetDuration: number | null
  wordsPerSecond: number
  autoLayout: boolean
}>

function pushAudioLine(audio: Y.Array<YMap>, init: AudioLineInit): string {
  const id = newId()
  const m: YMap = new Y.Map()
  audio.push([m])
  m.set('id', id)
  m.set('kind', init.kind ?? 'vo')
  m.set('speaker', init.speaker ?? '')
  m.set('lang', init.lang ?? 'en')
  m.set('text', new Y.Text(init.text ?? ''))
  m.set('assetId', init.assetId ?? null)
  return id
}

function indexOf<T>(array: Y.Array<T>, match: (item: T) => boolean): number {
  let index = -1
  array.forEach((item, i) => {
    if (index === -1 && match(item)) index = i
  })
  return index
}

/**
 * A storyboard project stored in a Yjs document. Every edit goes through these
 * commands, whether it comes from the app, the server, or Claude via MCP.
 */
export class Project implements ProjectRoots {
  readonly doc: Y.Doc
  /** Transaction origin for edits made through this instance (used by undo). */
  readonly origin: object

  constructor(doc: Y.Doc, origin: object = { source: 'local' }) {
    this.doc = doc
    this.origin = origin
  }

  get meta(): YMap {
    return this.doc.getMap('meta')
  }
  get frames(): Y.Map<YMap> {
    return this.doc.getMap('frames')
  }
  get links(): Y.Map<YMap> {
    return this.doc.getMap('links')
  }
  get cuts(): Y.Map<YMap> {
    return this.doc.getMap('cuts')
  }
  get scenes(): Y.Map<YMap> {
    return this.doc.getMap('scenes')
  }
  get assets(): Y.Map<YMap> {
    return this.doc.getMap('assets')
  }
  get bible(): Y.Map<YMap> {
    return this.doc.getMap('bible')
  }
  get brief(): YMap {
    return this.doc.getMap('brief')
  }
  get pages(): Y.Map<YMap> {
    return this.doc.getMap('pages')
  }
  /** Notes content per page, kept apart from `pages` so typing never touches page metadata. */
  get pageContent(): Y.Map<Y.XmlFragment> {
    return this.doc.getMap('pageContent')
  }
  get moodboard(): Y.Map<YMap> {
    return this.doc.getMap('moodboard')
  }

  /**
   * The root types edited through this class, for undo managers. Notes typing
   * has its own origin and undo history (the editor's), so it isn't captured,
   * but deleting a page is: undoing that brings its content back.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches Y.UndoManager's signature
  get roots(): Y.AbstractType<any>[] {
    return [
      this.meta,
      this.frames,
      this.links,
      this.cuts,
      this.scenes,
      this.assets,
      this.bible,
      this.brief,
      this.pages,
      this.pageContent,
      this.moodboard,
    ]
  }

  transact<T>(fn: () => T): T {
    let result: T | undefined
    this.doc.transact(() => {
      result = fn()
    }, this.origin)
    return result as T
  }

  snapshot(): ProjectSnapshot {
    return buildSnapshot(this)
  }

  getMeta(): ProjectMeta {
    return readMeta(this.meta)
  }

  getFrame(id: string): FrameSnapshot | null {
    const m = this.frames.get(id)
    return m ? readFrame(m) : null
  }

  mainCutId(): string {
    return str(this.meta.get('mainCutId'))
  }

  // ------------------------------------------------------------------ lookup

  private requireFrame(id: string): YMap {
    const m = this.frames.get(id)
    if (!m) throw new WeftError('not-found', `Frame ${id} doesn't exist`)
    return m
  }

  private requireLink(id: string): YMap {
    const m = this.links.get(id)
    if (!m) throw new WeftError('not-found', `Link ${id} doesn't exist`)
    return m
  }

  private requireCut(id: string): YMap {
    const m = this.cuts.get(id)
    if (!m) throw new WeftError('not-found', `Cut ${id} doesn't exist`)
    return m
  }

  private requireScene(id: string): YMap {
    const m = this.scenes.get(id)
    if (!m) throw new WeftError('not-found', `Scene ${id} doesn't exist`)
    return m
  }

  private linksOut(frameId: string): LinkSnapshot[] {
    const out: LinkSnapshot[] = []
    for (const m of this.links.values()) if (m.get('from') === frameId) out.push(readLink(m))
    return out.sort(byCreation)
  }

  private linksIn(frameId: string): LinkSnapshot[] {
    const out: LinkSnapshot[] = []
    for (const m of this.links.values()) if (m.get('to') === frameId) out.push(readLink(m))
    return out.sort(byCreation)
  }

  /** True if there's a path of links from `from` to `to`, optionally not passing through `skip`. */
  canReach(from: string, to: string, skip?: string): boolean {
    const adjacency = new Map<string, string[]>()
    for (const m of this.links.values()) {
      const a = str(m.get('from'))
      const list = adjacency.get(a)
      if (list) list.push(str(m.get('to')))
      else adjacency.set(a, [str(m.get('to'))])
    }
    const stack = [from]
    const seen = new Set<string>()
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === to) return true
      if (seen.has(cur) || cur === skip) continue
      seen.add(cur)
      for (const next of adjacency.get(cur) ?? []) stack.push(next)
    }
    return false
  }

  // ------------------------------------------------------------------ frames

  createFrame(init: FrameInit = {}): string {
    return this.transact(() => {
      const id = newId()
      const m: YMap = new Y.Map()
      this.frames.set(id, m)
      m.set('id', id)
      m.set('createdAt', timestamp())
      m.set('x', init.x ?? 0)
      m.set('y', init.y ?? 0)
      m.set('sceneId', init.sceneId ?? null)
      for (const field of TEXT_FIELDS) m.set(field, new Y.Text(init[field] ?? ''))
      const audio = new Y.Array<YMap>()
      m.set('audio', audio)
      for (const line of init.audio ?? []) pushAudioLine(audio, line)
      m.set('shotSize', init.shotSize ?? null)
      m.set('angle', init.angle ?? null)
      m.set('movement', init.movement ?? null)
      m.set('lens', init.lens ?? null)
      m.set('durationMode', init.durationMode ?? 'auto')
      m.set('duration', clampSeconds(init.duration ?? DEFAULT_FRAME_SECONDS))
      m.set('media', new Y.Array<MediaVersion>())
      m.set('heroMediaId', null)
      const references = new Y.Array<string>()
      m.set('references', references)
      if (init.references?.length) references.push([...init.references])
      const tags = new Y.Array<string>()
      m.set('tags', tags)
      if (init.tags?.length) tags.push([...init.tags])
      m.set('status', init.status ?? 'draft')
      return id
    })
  }

  /** Adds a frame at the end of a cut (or the first frame of an empty project). */
  appendFrame(cutId = this.mainCutId(), init: FrameInit = {}): string {
    return this.transact(() => {
      const items = linearize(this.snapshot(), cutId)
      const last = items[items.length - 1]
      if (!last) return this.createFrame(init)
      return this.insertFrameAfter(last.frameId, { cutId, init })
    })
  }

  /**
   * Inserts a new frame right after `afterId`. If `afterId` already leads
   * somewhere, the new frame is spliced in between. At a fork, the path the
   * given cut follows is the one that gets spliced.
   */
  insertFrameAfter(afterId: string, opts: { cutId?: string; init?: FrameInit } = {}): string {
    return this.transact(() => {
      const after = readFrame(this.requireFrame(afterId))
      const outs = this.linksOut(afterId)
      let target: LinkSnapshot | undefined
      if (outs.length === 1) target = outs[0]
      else if (outs.length > 1) {
        const cut = this.cuts.get(opts.cutId ?? this.mainCutId())
        const choice = (cut?.get('choices') as Y.Map<string> | undefined)?.get(afterId)
        target = outs.find((l) => l.id === choice) ?? outs[0]
      }
      const id = this.createFrame({
        x: after.x + FRAME_SPACING_X,
        y: after.y,
        sceneId: after.sceneId,
        ...opts.init,
      })
      if (target) {
        // Keep the original link (and any cut choice pointing at it) as after -> new.
        this.requireLink(target.id).set('to', id)
        this.createLink(id, target.to, {})
      } else {
        this.createLink(afterId, id, {})
      }
      return id
    })
  }

  /**
   * Creates an alternative to `frameId` with the same incoming and outgoing
   * links, so it forks and merges back. Copies text and camera, not media.
   */
  addVariation(frameId: string): string {
    return this.transact(() => {
      const src = readFrame(this.requireFrame(frameId))
      const id = this.createFrame({
        x: src.x,
        y: src.y + FRAME_SPACING_Y,
        sceneId: src.sceneId,
        description: src.description,
        onScreenText: src.onScreenText,
        motionNotes: src.motionNotes,
        audio: src.audio.map(({ kind, speaker, text, lang }) => ({ kind, speaker, text, lang })),
        shotSize: src.shotSize,
        angle: src.angle,
        movement: src.movement,
        lens: src.lens,
        durationMode: src.durationMode,
        duration: src.duration,
        references: src.references,
        tags: src.tags,
      })
      for (const l of this.linksIn(frameId)) {
        this.createLink(l.from, id, { transition: l.transition, transitionDuration: l.transitionDuration })
      }
      for (const l of this.linksOut(frameId)) {
        this.createLink(id, l.to, { transition: l.transition, transitionDuration: l.transitionDuration })
      }
      return id
    })
  }

  /**
   * Removes a frame's links and connects its neighbours to each other, so the
   * story stays joined up: a fork moves to the frame before, a merge to the
   * frame after. Pairs already connected another way (as around a variation)
   * aren't bridged. Cuts that passed through the frame keep their path.
   */
  private bridgeAround(id: string): void {
    // How each cut passes through the frame, captured before anything changes.
    const snapshot = this.snapshot()
    const passes: Array<{ cut: YMap; inLinkId: string | null; outLinkId: string | null; next: string | null }> = []
    for (const cut of this.cuts.values()) {
      const items = linearize(snapshot, str(cut.get('id')))
      const k = items.findIndex((item) => item.frameId === id)
      if (k >= 0) {
        passes.push({
          cut,
          inLinkId: items[k]!.linkInId,
          outLinkId: items[k + 1]?.linkInId ?? null,
          next: items[k + 1]?.frameId ?? null,
        })
      }
    }

    const ins = this.linksIn(id)
    const outs = this.linksOut(id)
    const bridges = new Map<string, string>() // `${inLinkId}>${outLinkId}` -> link that now joins the two neighbours
    for (const inLink of ins) {
      let reused = false
      for (const outLink of outs) {
        if (inLink.from === outLink.to) continue
        const key = `${inLink.id}>${outLink.id}`
        const direct = this.linksOut(inLink.from).find((l) => l.to === outLink.to && l.id !== inLink.id)
        if (direct) {
          bridges.set(key, direct.id)
          continue
        }
        if (this.canReach(inLink.from, outLink.to, id)) continue
        if (!reused) {
          // Reuse the incoming link, so choices pointing at it stay valid.
          this.requireLink(inLink.id).set('to', outLink.to)
          bridges.set(key, inLink.id)
          reused = true
        } else {
          const created = this.createLink(inLink.from, outLink.to, {
            transition: outLink.transition,
            transitionDuration: outLink.transitionDuration,
          })
          bridges.set(key, created)
        }
      }
      if (!reused) this.removeLink(inLink.id)
    }
    for (const outLink of outs) this.removeLink(outLink.id)

    for (const { cut, inLinkId, outLinkId, next } of passes) {
      const choices = cut.get('choices') as Y.Map<string> | undefined
      choices?.delete(id)
      if (inLinkId && outLinkId) {
        const bridge = bridges.get(`${inLinkId}>${outLinkId}`)
        const before = ins.find((l) => l.id === inLinkId)?.from
        if (bridge && before && this.links.has(bridge)) choices?.set(before, bridge)
      } else if (!inLinkId && cut.get('start') === id) {
        cut.set('start', next)
      }
    }
  }

  /**
   * Deletes frames. Each one is bridged first, so the frames around it stay
   * connected (see `bridgeAround`).
   */
  deleteFrames(ids: readonly string[]): void {
    this.transact(() => {
      for (const id of ids) {
        if (!this.frames.has(id)) continue
        this.bridgeAround(id)
        this.frames.delete(id)
        for (const cut of this.cuts.values()) {
          ;(cut.get('choices') as Y.Map<string> | undefined)?.delete(id)
          ;(cut.get('hidden') as Y.Map<boolean> | undefined)?.delete(id)
          ;(cut.get('overrides') as Y.Map<number> | undefined)?.delete(id)
          if (cut.get('start') === id) cut.set('start', null)
        }
      }
    })
  }

  /** Takes a frame out of the sequence (cuts all its links) but keeps it on the board. */
  detachFrame(frameId: string): void {
    this.transact(() => {
      this.requireFrame(frameId)
      this.bridgeAround(frameId)
    })
  }

  /** Moves a frame into a link: A → B becomes A → frame → B. The frame leaves its old place first. */
  moveFrameToLink(frameId: string, linkId: string): void {
    this.transact(() => {
      this.requireFrame(frameId)
      const link = readLink(this.requireLink(linkId))
      if (link.from === frameId || link.to === frameId) return
      this.bridgeAround(frameId)
      if (this.links.has(linkId)) this.spliceInto(frameId, linkId)
    })
  }

  /** Moves a frame to just before or after another frame, following the given cut at forks. */
  moveFrameNextTo(frameId: string, targetId: string, side: 'before' | 'after', cutId?: string): void {
    this.transact(() => {
      if (frameId === targetId) return
      this.requireFrame(frameId)
      this.requireFrame(targetId)
      this.bridgeAround(frameId)
      this.placeNextTo(frameId, targetId, side, cutId)
    })
  }

  /** Inserts a new frame just before `beforeId` (see `insertFrameAfter`). */
  insertFrameBefore(beforeId: string, opts: { cutId?: string; init?: FrameInit } = {}): string {
    return this.transact(() => {
      const before = readFrame(this.requireFrame(beforeId))
      const id = this.createFrame({
        x: before.x - FRAME_SPACING_X,
        y: before.y,
        sceneId: before.sceneId,
        ...opts.init,
      })
      this.placeNextTo(id, beforeId, 'before', opts.cutId)
      return id
    })
  }

  /** Connects an unlinked frame next to `targetId`. */
  private placeNextTo(frameId: string, targetId: string, side: 'before' | 'after', cutId?: string): void {
    const cut = this.cuts.get(cutId ?? this.mainCutId())
    if (side === 'after') {
      const outs = this.linksOut(targetId)
      if (!outs.length) {
        this.createLink(targetId, frameId, {})
        return
      }
      const choice = (cut?.get('choices') as Y.Map<string> | undefined)?.get(targetId)
      this.spliceInto(frameId, (outs.find((l) => l.id === choice) ?? outs[0]!).id)
      return
    }
    const ins = this.linksIn(targetId)
    if (!ins.length) {
      this.createLink(frameId, targetId, {})
      for (const c of this.cuts.values()) if (c.get('start') === targetId) c.set('start', frameId)
      return
    }
    // Prefer the link the cut actually uses to reach the target.
    const item = cut ? linearize(this.snapshot(), str(cut.get('id'))).find((i) => i.frameId === targetId) : undefined
    this.spliceInto(frameId, (ins.find((l) => l.id === item?.linkInId) ?? ins[0]!).id)
  }

  /** A → B becomes A → frame → B, keeping the link's id (and any cut choice) on A → frame. */
  private spliceInto(frameId: string, linkId: string): void {
    const m = this.requireLink(linkId)
    const to = str(m.get('to'))
    m.set('to', frameId)
    this.createLink(frameId, to, {})
  }

  updateFrame(id: string, patch: FramePatch): void {
    this.transact(() => {
      const m = this.requireFrame(id)
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        if (!FRAME_PATCH_KEYS.has(key)) throw new WeftError('invalid', `Unknown frame field "${key}"`)
        m.set(key, key === 'duration' ? clampSeconds(value as number) : value)
      }
    })
  }

  /** Sets a manual duration (switches the frame out of auto timing). */
  setDuration(frameId: string, seconds: number): void {
    this.updateFrame(frameId, { durationMode: 'manual', duration: seconds })
  }

  /** Returns the frame to automatic timing (from VO, else its default). */
  resetDuration(frameId: string): void {
    this.updateFrame(frameId, { durationMode: 'auto' })
  }

  setPositions(positions: Readonly<Record<string, { x: number; y: number }>>): void {
    this.transact(() => {
      for (const [id, pos] of Object.entries(positions)) {
        const m = this.frames.get(id)
        if (!m) continue
        m.set('x', Math.round(pos.x))
        m.set('y', Math.round(pos.y))
      }
    })
  }

  /** The live Y.Text behind a text field, for editor bindings. */
  frameText(frameId: string, field: TextField): Y.Text {
    const m = this.requireFrame(frameId)
    const existing = m.get(field)
    if (existing instanceof Y.Text) return existing
    return this.transact(() => {
      const created = new Y.Text(typeof existing === 'string' ? existing : '')
      m.set(field, created)
      return created
    })
  }

  setText(frameId: string, field: TextField, value: string): void {
    this.transact(() => applyTextDiff(this.frameText(frameId, field), value))
  }

  // ------------------------------------------------------------- audio lines

  private audioArray(frameId: string): Y.Array<YMap> {
    const m = this.requireFrame(frameId)
    const existing = m.get('audio')
    if (existing instanceof Y.Array) return existing as Y.Array<YMap>
    const created = new Y.Array<YMap>()
    this.transact(() => m.set('audio', created))
    return created
  }

  private audioLine(frameId: string, lineId: string): YMap {
    const line = this.audioArray(frameId)
      .toArray()
      .find((l) => l.get('id') === lineId)
    if (!line) throw new WeftError('not-found', `Audio line ${lineId} doesn't exist`)
    return line
  }

  addAudioLine(frameId: string, init: AudioLineInit = {}): string {
    return this.transact(() => pushAudioLine(this.audioArray(frameId), init))
  }

  updateAudioLine(frameId: string, lineId: string, patch: { kind?: AudioKind; speaker?: string; lang?: string }): void {
    this.transact(() => {
      const line = this.audioLine(frameId, lineId)
      if (patch.kind !== undefined) line.set('kind', patch.kind)
      if (patch.speaker !== undefined) line.set('speaker', patch.speaker)
      if (patch.lang !== undefined) line.set('lang', patch.lang)
    })
  }

  audioText(frameId: string, lineId: string): Y.Text {
    const line = this.audioLine(frameId, lineId)
    const existing = line.get('text')
    if (existing instanceof Y.Text) return existing
    return this.transact(() => {
      const created = new Y.Text(typeof existing === 'string' ? existing : '')
      line.set('text', created)
      return created
    })
  }

  setAudioText(frameId: string, lineId: string, value: string): void {
    this.transact(() => applyTextDiff(this.audioText(frameId, lineId), value))
  }

  /** Attaches recorded (or generated) audio to a line, or removes it with null. */
  setAudioAsset(frameId: string, lineId: string, assetId: string | null): void {
    this.transact(() => this.audioLine(frameId, lineId).set('assetId', assetId))
  }

  removeAudioLine(frameId: string, lineId: string): void {
    this.transact(() => {
      const audio = this.audioArray(frameId)
      const index = indexOf(audio, (l) => l.get('id') === lineId)
      if (index >= 0) audio.delete(index, 1)
    })
  }

  /** Id of the frame's first VO line, creating an empty one if there isn't one. */
  voLineId(frameId: string): string {
    return this.transact(() => {
      const existing = this.audioArray(frameId)
        .toArray()
        .find((l) => l.get('kind') === 'vo')
      const id = existing?.get('id')
      return typeof id === 'string' ? id : this.addAudioLine(frameId, { kind: 'vo' })
    })
  }

  /** Sets the text of the frame's first VO line. */
  setVo(frameId: string, value: string): void {
    this.transact(() => this.setAudioText(frameId, this.voLineId(frameId), value))
  }

  // ------------------------------------------------------ media and references

  addMediaVersion(
    frameId: string,
    assetId: string,
    opts: { source?: MediaSource; label?: string; makeHero?: boolean } = {},
  ): string {
    return this.transact(() => {
      const m = this.requireFrame(frameId)
      let media = m.get('media')
      if (!(media instanceof Y.Array)) {
        media = new Y.Array<MediaVersion>()
        m.set('media', media)
      }
      const version: MediaVersion = {
        id: newId(),
        assetId,
        createdAt: timestamp(),
        source: opts.source ?? 'upload',
        label: opts.label ?? '',
      }
      ;(media as Y.Array<MediaVersion>).push([version])
      if (opts.makeHero !== false) m.set('heroMediaId', version.id)
      return version.id
    })
  }

  setHeroMedia(frameId: string, mediaId: string | null): void {
    this.transact(() => this.requireFrame(frameId).set('heroMediaId', mediaId))
  }

  removeMediaVersion(frameId: string, mediaId: string): void {
    this.transact(() => {
      const m = this.requireFrame(frameId)
      const media = m.get('media')
      if (!(media instanceof Y.Array)) return
      const list = media as Y.Array<MediaVersion>
      const index = indexOf(list, (v) => v.id === mediaId)
      if (index >= 0) list.delete(index, 1)
      if (m.get('heroMediaId') === mediaId) {
        const last = list.length ? list.get(list.length - 1) : undefined
        m.set('heroMediaId', last?.id ?? null)
      }
    })
  }

  private stringArray(frameId: string, key: 'references' | 'tags'): Y.Array<string> {
    const m = this.requireFrame(frameId)
    const existing = m.get(key)
    if (existing instanceof Y.Array) return existing as Y.Array<string>
    const created = new Y.Array<string>()
    this.transact(() => m.set(key, created))
    return created
  }

  addReference(frameId: string, assetId: string): void {
    this.transact(() => {
      const refs = this.stringArray(frameId, 'references')
      if (!refs.toArray().includes(assetId)) refs.push([assetId])
    })
  }

  removeReference(frameId: string, assetId: string): void {
    this.transact(() => {
      const refs = this.stringArray(frameId, 'references')
      const index = refs.toArray().indexOf(assetId)
      if (index >= 0) refs.delete(index, 1)
    })
  }

  setTags(frameId: string, tags: readonly string[]): void {
    this.transact(() => {
      const arr = this.stringArray(frameId, 'tags')
      arr.delete(0, arr.length)
      arr.push([...new Set(tags)])
    })
  }

  // ------------------------------------------------------------------- links

  private createLink(from: string, to: string, init: LinkPatch): string {
    const id = newId()
    const m: YMap = new Y.Map()
    this.links.set(id, m)
    m.set('id', id)
    m.set('from', from)
    m.set('to', to)
    m.set('createdAt', timestamp())
    m.set('transition', init.transition ?? 'cut')
    m.set('transitionDuration', init.transitionDuration ?? 0)
    m.set('note', init.note ?? '')
    return id
  }

  private removeLink(linkId: string): void {
    this.links.delete(linkId)
    for (const cut of this.cuts.values()) {
      const choices = cut.get('choices')
      if (!(choices instanceof Y.Map)) continue
      for (const [fork, chosen] of [...choices.entries()]) if (chosen === linkId) choices.delete(fork)
    }
  }

  /** Connects two frames. Returns the existing link if they're already connected. */
  linkFrames(from: string, to: string, init: LinkPatch = {}): string {
    return this.transact(() => {
      this.requireFrame(from)
      this.requireFrame(to)
      if (from === to) throw new WeftError('invalid', "A frame can't link to itself")
      const existing = this.linksOut(from).find((l) => l.to === to)
      if (existing) return existing.id
      if (this.canReach(to, from)) throw new WeftError('cycle', 'That link would loop back to an earlier frame')
      return this.createLink(from, to, init)
    })
  }

  deleteLink(linkId: string): void {
    this.transact(() => this.removeLink(linkId))
  }

  deleteLinks(linkIds: readonly string[]): void {
    this.transact(() => {
      for (const id of linkIds) if (this.links.has(id)) this.removeLink(id)
    })
  }

  updateLink(linkId: string, patch: LinkPatch): void {
    this.transact(() => {
      const m = this.requireLink(linkId)
      if (patch.transition !== undefined) m.set('transition', patch.transition)
      if (patch.transitionDuration !== undefined) m.set('transitionDuration', Math.max(0, patch.transitionDuration))
      if (patch.note !== undefined) m.set('note', patch.note)
    })
  }

  // -------------------------------------------------------------------- cuts

  createCut(name: string, opts: { copyFrom?: string; main?: boolean } = {}): string {
    return this.transact(() => {
      const src = opts.copyFrom ? this.requireCut(opts.copyFrom) : undefined
      const id = newId()
      const m: YMap = new Y.Map()
      this.cuts.set(id, m)
      m.set('id', id)
      m.set('name', name)
      m.set('createdAt', timestamp())
      m.set('isMain', opts.main === true)
      m.set('targetDuration', src ? (src.get('targetDuration') ?? null) : null)
      m.set('start', src ? (src.get('start') ?? null) : null)
      for (const key of ['choices', 'hidden', 'overrides'] as const) {
        const map = new Y.Map<unknown>()
        m.set(key, map)
        const from = src?.get(key)
        if (from instanceof Y.Map) for (const [k, v] of from.entries()) map.set(k, v)
      }
      const beats = new Y.Array<number>()
      m.set('beats', beats)
      const srcBeats = src?.get('beats')
      if (srcBeats instanceof Y.Array) beats.push(srcBeats.toArray().filter((b): b is number => typeof b === 'number'))
      for (const key of ['musicAssetId', 'musicOffset', 'musicVolume'] as const) {
        const value = src?.get(key)
        if (value !== undefined) m.set(key, value)
      }
      return id
    })
  }

  // ------------------------------------------------------------ music, beats

  setCutMusic(cutId: string, assetId: string | null): void {
    this.transact(() => {
      const cut = this.requireCut(cutId)
      cut.set('musicAssetId', assetId)
      if (assetId && cut.get('musicOffset') === undefined) cut.set('musicOffset', 0)
    })
  }

  setMusicOffset(cutId: string, seconds: number): void {
    this.transact(() => this.requireCut(cutId).set('musicOffset', Math.round(seconds * 100) / 100))
  }

  setMusicVolume(cutId: string, volume: number): void {
    this.transact(() => this.requireCut(cutId).set('musicVolume', Math.min(1, Math.max(0, volume))))
  }

  private beatsOf(cutId: string): Y.Array<number> {
    const cut = this.requireCut(cutId)
    const existing = cut.get('beats')
    if (existing instanceof Y.Array) return existing as Y.Array<number>
    const created = new Y.Array<number>()
    this.transact(() => cut.set('beats', created))
    return created
  }

  /** Adds a beat marker (ignored if there's already one within 50 ms). */
  addBeat(cutId: string, seconds: number): void {
    this.transact(() => {
      const beats = this.beatsOf(cutId)
      const t = Math.round(seconds * 1000) / 1000
      if (!beats.toArray().some((b) => Math.abs(b - t) < 0.05)) beats.push([t])
    })
  }

  /** Removes the beat marker nearest to `seconds`, if one is within `tolerance`. */
  removeBeat(cutId: string, seconds: number, tolerance = 0.1): void {
    this.transact(() => {
      const beats = this.beatsOf(cutId)
      let best = -1
      let bestDistance = tolerance
      beats.forEach((b, i) => {
        const d = Math.abs(b - seconds)
        if (d <= bestDistance) {
          best = i
          bestDistance = d
        }
      })
      if (best >= 0) beats.delete(best, 1)
    })
  }

  clearBeats(cutId: string): void {
    this.transact(() => {
      const beats = this.beatsOf(cutId)
      beats.delete(0, beats.length)
    })
  }

  renameCut(cutId: string, name: string): void {
    this.transact(() => this.requireCut(cutId).set('name', name))
  }

  setCutTarget(cutId: string, seconds: number | null): void {
    this.transact(() => this.requireCut(cutId).set('targetDuration', seconds === null ? null : clampSeconds(seconds)))
  }

  setCutStart(cutId: string, frameId: string | null): void {
    this.transact(() => {
      if (frameId) this.requireFrame(frameId)
      this.requireCut(cutId).set('start', frameId)
    })
  }

  /** Makes the cut follow this link at its fork. */
  chooseLink(cutId: string, linkId: string): void {
    this.transact(() => {
      const link = readLink(this.requireLink(linkId))
      ;(this.requireCut(cutId).get('choices') as Y.Map<string>).set(link.from, linkId)
    })
  }

  /** Changes the cut's choices so its path runs through `frameId`. */
  routeThrough(cutId: string, frameId: string): void {
    this.transact(() => {
      const cut = this.requireCut(cutId)
      this.requireFrame(frameId)
      const s = this.snapshot()
      const onPath = new Set(linearize(s, cutId).map((i) => i.frameId))
      if (onPath.has(frameId)) return
      const incoming = new Map<string, LinkSnapshot[]>()
      for (const l of Object.values(s.links)) {
        const list = incoming.get(l.to)
        if (list) list.push(l)
        else incoming.set(l.to, [l])
      }
      // Walk backwards to the nearest frame on the path, or to a root.
      const next = new Map<string, LinkSnapshot>()
      const queue = [frameId]
      const seen = new Set(queue)
      let anchor: string | null = null
      while (queue.length) {
        const cur = queue.shift()!
        const ins = (incoming.get(cur) ?? []).sort(byCreation)
        if (onPath.has(cur) || !ins.length) {
          anchor = cur
          break
        }
        for (const l of ins) {
          if (seen.has(l.from)) continue
          seen.add(l.from)
          next.set(l.from, l)
          queue.push(l.from)
        }
      }
      if (!anchor) return
      if (!onPath.has(anchor)) cut.set('start', anchor)
      const choices = cut.get('choices') as Y.Map<string>
      let cur = anchor
      while (cur !== frameId) {
        const l = next.get(cur)
        if (!l) break
        choices.set(cur, l.id)
        cur = l.to
      }
    })
  }

  setHidden(cutId: string, frameId: string, hidden: boolean): void {
    this.transact(() => {
      const map = this.requireCut(cutId).get('hidden') as Y.Map<boolean>
      if (hidden) map.set(frameId, true)
      else map.delete(frameId)
    })
  }

  setOverride(cutId: string, frameId: string, seconds: number | null): void {
    this.transact(() => {
      const map = this.requireCut(cutId).get('overrides') as Y.Map<number>
      if (seconds === null) map.delete(frameId)
      else map.set(frameId, clampSeconds(seconds))
    })
  }

  deleteCut(cutId: string): void {
    this.transact(() => {
      if (this.requireCut(cutId).get('isMain') === true) throw new WeftError('invalid', "The main cut can't be deleted")
      this.cuts.delete(cutId)
    })
  }

  // ------------------------------------------------------------------ scenes

  createScene(init: ScenePatch = {}): string {
    return this.transact(() => {
      const id = newId()
      const m: YMap = new Y.Map()
      this.scenes.set(id, m)
      m.set('id', id)
      m.set('createdAt', timestamp())
      m.set('title', init.title ?? '')
      m.set('intExt', init.intExt ?? '')
      m.set('location', init.location ?? '')
      m.set('timeOfDay', init.timeOfDay ?? '')
      m.set('color', init.color ?? 'violet')
      return id
    })
  }

  updateScene(sceneId: string, patch: ScenePatch): void {
    this.transact(() => {
      const m = this.requireScene(sceneId)
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) m.set(key, value)
    })
  }

  deleteScene(sceneId: string): void {
    this.transact(() => {
      for (const f of this.frames.values()) if (f.get('sceneId') === sceneId) f.set('sceneId', null)
      this.scenes.delete(sceneId)
    })
  }

  assignScene(frameIds: readonly string[], sceneId: string | null): void {
    this.transact(() => {
      if (sceneId) this.requireScene(sceneId)
      for (const id of frameIds) this.requireFrame(id).set('sceneId', sceneId)
    })
  }

  // ------------------------------------------------------------------ assets

  /** Adds an asset, or returns the existing one with the same file or URL. */
  addAsset(init: AssetInit): string {
    return this.transact(() => {
      for (const m of this.assets.values()) {
        if (init.hash && m.get('hash') === init.hash) return str(m.get('id'))
        if (init.kind === 'link' && init.url && m.get('kind') === 'link' && m.get('url') === init.url) {
          return str(m.get('id'))
        }
      }
      const id = newId()
      const m: YMap = new Y.Map()
      this.assets.set(id, m)
      m.set('id', id)
      m.set('createdAt', timestamp())
      m.set('kind', init.kind)
      m.set('hash', init.hash ?? null)
      m.set('name', init.name ?? '')
      m.set('mime', init.mime ?? '')
      m.set('size', init.size ?? 0)
      m.set('width', init.width ?? null)
      m.set('height', init.height ?? null)
      m.set('duration', init.duration ?? null)
      m.set('url', init.url ?? null)
      m.set('title', init.title ?? '')
      m.set('preview', init.preview ?? null)
      m.set('site', init.site ?? '')
      m.set('createdBy', init.createdBy ?? null)
      return id
    })
  }

  updateAsset(assetId: string, patch: Partial<Omit<AssetInit, 'kind' | 'hash'>>): void {
    this.transact(() => {
      const m = this.assets.get(assetId)
      if (!m) throw new WeftError('not-found', `Asset ${assetId} doesn't exist`)
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) m.set(key, value)
    })
  }

  /** Deletes an asset and removes it everywhere it's used. */
  deleteAsset(assetId: string): void {
    this.transact(() => {
      for (const id of this.frames.keys()) {
        const frame = this.getFrame(id)
        if (!frame) continue
        if (frame.references.includes(assetId)) this.removeReference(id, assetId)
        for (const v of frame.media) if (v.assetId === assetId) this.removeMediaVersion(id, v.id)
      }
      for (const id of this.bible.keys()) this.removeBibleAsset(id, assetId)
      this.removeStyleRef(assetId)
      const items = [...this.moodboard.values()].filter((m) => m.get('assetId') === assetId).map((m) => str(m.get('id')))
      this.deleteMoodItems(items)
      this.assets.delete(assetId)
    })
  }

  // ------------------------------------------------------------------- pages

  /** A notes page. Passing an id makes creation idempotent (for default pages). */
  createPage(title = 'Untitled', id: string = newId()): string {
    return this.transact(() => {
      if (!this.pages.has(id)) {
        const m: YMap = new Y.Map()
        this.pages.set(id, m)
        m.set('id', id)
        m.set('title', title)
        m.set('createdAt', timestamp())
      }
      if (!this.pageContent.has(id)) this.pageContent.set(id, new Y.XmlFragment())
      return id
    })
  }

  renamePage(pageId: string, title: string): void {
    this.transact(() => this.pages.get(pageId)?.set('title', title))
  }

  deletePage(pageId: string): void {
    this.transact(() => {
      this.pages.delete(pageId)
      this.pageContent.delete(pageId)
    })
  }

  /** The page's rich-text content, for the notes editor. */
  pageFragment(pageId: string): Y.XmlFragment {
    const existing = this.pageContent.get(pageId)
    if (existing instanceof Y.XmlFragment) return existing
    return this.transact(() => {
      const created = new Y.XmlFragment()
      this.pageContent.set(pageId, created)
      return created
    })
  }

  /** Projects start with a notes page; this adds it to projects made before pages existed. */
  ensureNotesPage(): string {
    const first = [...this.pages.values()].sort((a, b) => num(a.get('createdAt')) - num(b.get('createdAt')))[0]
    return first ? str(first.get('id')) : this.createPage('Notes', 'notes')
  }

  // ------------------------------------------------------------------- bible

  private requireBible(id: string): YMap {
    const m = this.bible.get(id)
    if (!m) throw new WeftError('not-found', `Bible entry ${id} doesn't exist`)
    return m
  }

  createBibleEntry(kind: BibleKind, init: { name?: string; description?: string } = {}): string {
    return this.transact(() => {
      const id = newId()
      const m: YMap = new Y.Map()
      this.bible.set(id, m)
      m.set('id', id)
      m.set('kind', kind)
      m.set('name', init.name ?? '')
      m.set('description', new Y.Text(init.description ?? ''))
      m.set('assetIds', new Y.Array<string>())
      m.set('createdAt', timestamp())
      return id
    })
  }

  updateBibleEntry(id: string, patch: { name?: string; kind?: BibleKind }): void {
    this.transact(() => {
      const m = this.requireBible(id)
      if (patch.name !== undefined) m.set('name', patch.name)
      if (patch.kind !== undefined) m.set('kind', patch.kind)
    })
  }

  bibleText(id: string): Y.Text {
    const m = this.requireBible(id)
    const existing = m.get('description')
    if (existing instanceof Y.Text) return existing
    return this.transact(() => {
      const created = new Y.Text(typeof existing === 'string' ? existing : '')
      m.set('description', created)
      return created
    })
  }

  private bibleAssets(id: string): Y.Array<string> {
    const m = this.requireBible(id)
    const existing = m.get('assetIds')
    if (existing instanceof Y.Array) return existing as Y.Array<string>
    const created = new Y.Array<string>()
    this.transact(() => m.set('assetIds', created))
    return created
  }

  addBibleAsset(id: string, assetId: string): void {
    this.transact(() => {
      const list = this.bibleAssets(id)
      if (!list.toArray().includes(assetId)) list.push([assetId])
    })
  }

  removeBibleAsset(id: string, assetId: string): void {
    this.transact(() => {
      if (!this.bible.has(id)) return
      const list = this.bibleAssets(id)
      const index = list.toArray().indexOf(assetId)
      if (index >= 0) list.delete(index, 1)
    })
  }

  /** Deletes a bible entry and untags it from every frame. */
  deleteBibleEntry(id: string): void {
    this.transact(() => {
      for (const frameId of this.frames.keys()) {
        const tags = this.getFrame(frameId)?.tags ?? []
        if (tags.includes(id)) this.setTags(frameId, tags.filter((t) => t !== id))
      }
      this.bible.delete(id)
    })
  }

  toggleFrameTag(frameId: string, entryId: string): void {
    this.transact(() => {
      const tags = this.getFrame(frameId)?.tags ?? []
      this.setTags(frameId, tags.includes(entryId) ? tags.filter((t) => t !== entryId) : [...tags, entryId])
    })
  }

  // ------------------------------------------------------------------- brief

  briefText(field: BriefField): Y.Text {
    const existing = this.brief.get(field)
    if (existing instanceof Y.Text) return existing
    return this.transact(() => {
      const created = new Y.Text(typeof existing === 'string' ? existing : '')
      this.brief.set(field, created)
      return created
    })
  }

  private styleRefs(): Y.Array<string> {
    const existing = this.brief.get('styleRefs')
    if (existing instanceof Y.Array) return existing as Y.Array<string>
    const created = new Y.Array<string>()
    this.transact(() => this.brief.set('styleRefs', created))
    return created
  }

  addStyleRef(assetId: string): void {
    this.transact(() => {
      const list = this.styleRefs()
      if (!list.toArray().includes(assetId)) list.push([assetId])
    })
  }

  removeStyleRef(assetId: string): void {
    this.transact(() => {
      const list = this.styleRefs()
      const index = list.toArray().indexOf(assetId)
      if (index >= 0) list.delete(index, 1)
    })
  }

  // --------------------------------------------------------------- moodboard

  addMoodItem(init: MoodItemInit): string {
    return this.transact(() => {
      const id = newId()
      const m: YMap = new Y.Map()
      this.moodboard.set(id, m)
      m.set('id', id)
      m.set('kind', init.kind)
      m.set('assetId', init.assetId ?? null)
      m.set('text', new Y.Text(init.text ?? ''))
      m.set('color', init.color ?? '#f2c14e')
      m.set('x', Math.round(init.x))
      m.set('y', Math.round(init.y))
      m.set('w', Math.round(init.w ?? 240))
      m.set('h', Math.round(init.h ?? 180))
      m.set('createdAt', timestamp())
      return id
    })
  }

  updateMoodItem(id: string, patch: Partial<Pick<MoodItemInit, 'x' | 'y' | 'w' | 'h' | 'color' | 'assetId'>>): void {
    this.transact(() => {
      const m = this.moodboard.get(id)
      if (!m) return
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        m.set(key, typeof value === 'number' ? Math.round(value) : value)
      }
    })
  }

  moodText(id: string): Y.Text {
    const m = this.moodboard.get(id)
    if (!m) throw new WeftError('not-found', `Moodboard item ${id} doesn't exist`)
    const existing = m.get('text')
    if (existing instanceof Y.Text) return existing
    return this.transact(() => {
      const created = new Y.Text(typeof existing === 'string' ? existing : '')
      m.set('text', created)
      return created
    })
  }

  setMoodPositions(positions: Readonly<Record<string, { x: number; y: number }>>): void {
    this.transact(() => {
      for (const [id, pos] of Object.entries(positions)) {
        const m = this.moodboard.get(id)
        if (!m) continue
        m.set('x', Math.round(pos.x))
        m.set('y', Math.round(pos.y))
      }
    })
  }

  deleteMoodItems(ids: readonly string[]): void {
    this.transact(() => {
      for (const id of ids) this.moodboard.delete(id)
    })
  }

  // -------------------------------------------------------------------- meta

  updateMeta(patch: MetaPatch): void {
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) this.meta.set(key, value)
    })
  }
}
