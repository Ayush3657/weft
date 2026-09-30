import {
  CAMERA_ANGLES,
  CAMERA_MOVES,
  SHOT_SIZES,
  TRANSITIONS,
  countWords,
  cutTimeline,
  findOption,
  formatDuration,
  formatSeconds,
  graphOf,
  notesToMarkdown,
  shotLabels,
  type BibleEntrySnapshot,
  type FrameSnapshot,
  type Project,
  type ProjectSnapshot,
  type TimelineItem,
} from '@weft/model'
import { AgentError } from './session'

// ----------------------------------------------------------- finding things

const norm = (s: string) => s.trim().toLowerCase()

export function resolveCut(s: ProjectSnapshot, ref: string | undefined | null): string {
  if (!ref) return s.meta.mainCutId
  if (s.cuts[ref]) return ref
  const wanted = norm(ref)
  if (wanted === 'main' || wanted === 'main cut') return s.meta.mainCutId
  const matches = Object.values(s.cuts).filter((c) => norm(c.name) === wanted)
  if (matches.length === 1) return matches[0]!.id
  throw new AgentError(`No cut called "${ref}". Cuts: ${Object.values(s.cuts).map((c) => `"${c.name}"`).join(', ')}.`)
}

/** A frame from its shot number ("3", "12B", "frame 4") or its id. */
export function resolveFrame(s: ProjectSnapshot, ref: string): string {
  const trimmed = ref.trim().replace(/^(frame|shot)\s+/i, '')
  if (s.frames[trimmed]) return trimmed
  const labels = shotLabels(s)
  for (const [id, label] of labels) if (label.toLowerCase() === trimmed.toLowerCase()) return id
  const known = [...labels.values()]
  throw new AgentError(
    `No frame "${ref}". Use a shot number (${known.slice(0, 40).join(', ')}${known.length > 40 ? ', …' : ''}) or a frame id.`,
  )
}

export function resolveEntry(s: ProjectSnapshot, ref: string): BibleEntrySnapshot | null {
  if (s.bible[ref]) return s.bible[ref]
  const wanted = norm(ref.replace(/^@/, ''))
  return Object.values(s.bible).find((e) => norm(e.name) === wanted) ?? null
}

export function resolvePage(s: ProjectSnapshot, ref: string | undefined | null): string | null {
  const pages = Object.values(s.pages).sort((a, b) => a.createdAt - b.createdAt)
  if (!ref) return pages[0]?.id ?? null
  if (s.pages[ref]) return ref
  return pages.find((p) => norm(p.title || 'Untitled') === norm(ref))?.id ?? null
}

// --------------------------------------------------------------- describing

const clock = (seconds: number) => formatSeconds(seconds)
const quote = (text: string) => text.replace(/\s+/g, ' ').trim()
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

function cameraOf(f: FrameSnapshot): string {
  return [findOption(SHOT_SIZES, f.shotSize)?.label, findOption(CAMERA_ANGLES, f.angle)?.label, findOption(CAMERA_MOVES, f.movement)?.label, f.lens]
    .filter(Boolean)
    .join(' · ')
}

function audioLines(f: FrameSnapshot): string[] {
  return f.audio
    .filter((l) => l.text.trim() || l.assetId)
    .map((l) => {
      const who = l.kind === 'vo' ? (l.speaker ? `VO (${l.speaker})` : 'VO') : l.speaker || 'Dialogue'
      return `${who}: ${quote(l.text) || '(recorded, no script)'}${l.assetId ? ' [recorded]' : ''}`
    })
}

function tagsOf(s: ProjectSnapshot, f: FrameSnapshot): string {
  return f.tags
    .map((id) => s.bible[id])
    .filter((e): e is BibleEntrySnapshot => !!e)
    .map((e) => `${e.name || 'Unnamed'} (${e.kind})`)
    .join(', ')
}

function lengthSource(s: ProjectSnapshot, f: FrameSnapshot, item: TimelineItem | undefined): string {
  if (item?.hidden) return 'hidden in this cut'
  if (item?.overridden) return 'set for this cut'
  if (f.durationMode === 'manual') return 'set by hand'
  if (f.audio.some((l) => l.assetId && s.assets[l.assetId]?.duration)) return 'timed from the recorded VO'
  if (f.audio.some((l) => countWords(l.text) > 0)) return 'timed from the VO'
  return 'default length'
}

/** One frame as text: what we see and hear, camera, length, tags. `full` adds notes and media. */
export function describeFrame(s: ProjectSnapshot, frameId: string, opts: { item?: TimelineItem; full?: boolean } = {}): string {
  const f = s.frames[frameId]
  if (!f) return `(missing frame ${frameId})`
  const label = shotLabels(s).get(frameId) ?? 'unlinked'
  const { item } = opts
  const seconds = item ? item.base : f.duration
  const head = [
    `${label}`,
    item ? `${clock(item.start)}–${clock(item.start + item.duration)}` : null,
    `${formatDuration(seconds)} (${lengthSource(s, f, item)})`,
    `id ${f.id}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const lines = [head]
  lines.push(`  Video: ${quote(f.description) || '(no description)'}`)
  for (const line of audioLines(f)) lines.push(`  ${line}`)
  if (f.onScreenText.trim()) lines.push(`  On screen: ${quote(f.onScreenText)}`)
  const camera = cameraOf(f)
  if (camera) lines.push(`  Camera: ${camera}`)
  const tags = tagsOf(s, f)
  if (tags) lines.push(`  In shot: ${tags}`)
  const scene = f.sceneId ? s.scenes[f.sceneId] : undefined
  const hero = f.media.find((m) => m.id === f.heroMediaId)
  const bits = [
    scene ? `Scene: ${scene.title || 'Untitled'}` : null,
    hero ? `Picture: ${s.assets[hero.assetId]?.kind ?? 'image'}${f.media.length > 1 ? ` (${f.media.length} versions)` : ''}` : 'No picture yet',
    f.references.length ? `${f.references.length} reference${f.references.length === 1 ? '' : 's'}` : null,
    f.status !== 'draft' ? `Status: ${f.status}` : null,
  ].filter(Boolean)
  lines.push(`  ${bits.join(' · ')}`)
  if (opts.full) {
    if (f.motionNotes.trim()) lines.push(`  Motion notes: ${quote(f.motionNotes)}`)
    if (f.notes.trim()) lines.push(`  Notes: ${f.notes.trim().replace(/\n/g, '\n    ')}`)
    for (const id of f.references) {
      const a = s.assets[id]
      if (a) lines.push(`  Reference: ${a.kind} "${a.title || a.name || a.url || id}"${a.url ? ` ${a.url}` : ''}`)
    }
    const overrides = Object.values(s.cuts)
      .filter((c) => c.overrides[frameId] !== undefined || c.hidden[frameId])
      .map((c) => `${c.name}: ${c.hidden[frameId] ? 'hidden' : `${formatDuration(c.overrides[frameId]!)}`}`)
    if (overrides.length) lines.push(`  Per cut: ${overrides.join('; ')}`)
  }
  return lines.join('\n')
}

/** A cut's frames in order, with timing, transitions and the variations available at each point. */
export function describeCut(s: ProjectSnapshot, cutId: string): string {
  const cut = s.cuts[cutId]
  if (!cut) throw new AgentError(`Cut ${cutId} doesn't exist`)
  const t = cutTimeline(s, cutId)
  const labels = shotLabels(s)
  const g = graphOf(s)
  const out = [
    `Cut "${cut.name}"${cut.isMain ? ' (main)' : ''} · runs ${clock(t.total)}${cut.targetDuration ? ` of a ${clock(cut.targetDuration)} target` : ''} · ${t.items.length} shots · VO pace ${s.meta.wordsPerSecond} words per second`,
  ]
  if (!t.items.length) out.push('(no frames yet)')
  for (const item of t.items) {
    const link = item.linkInId ? s.links[item.linkInId] : undefined
    if (link && (link.transition !== 'cut' || link.note)) {
      const kind = findOption(TRANSITIONS, link.transition)?.label ?? link.transition
      out.push(`  ↓ ${kind}${link.transition !== 'cut' ? ` ${formatDuration(link.transitionDuration)}` : ''}${link.note ? ` (${link.note})` : ''}`)
    }
    out.push(describeFrame(s, item.frameId, { item }))
    const siblings = link ? g.out(link.from).filter((l) => l.to !== item.frameId) : []
    if (siblings.length) out.push(`  Other variations here: ${siblings.map((l) => labels.get(l.to) ?? l.to).join(', ')}`)
  }
  const inCut = new Set(t.items.map((i) => i.frameId))
  const others = Object.values(s.frames).filter((f) => !inCut.has(f.id))
  if (others.length) {
    out.push(
      `Not in this cut: ${others
        .map((f) => `${labels.get(f.id) ?? `unlinked ${f.id}`} "${clip(quote(f.description) || 'no description', 40)}"`)
        .join('; ')}`,
    )
  }
  return out.join('\n')
}

const cell = (text: string) => quote(text).replace(/\|/g, '\\|') || ' '

/** The AV script for a cut, as a Markdown table. */
export function scriptTable(s: ProjectSnapshot, cutId: string): string {
  const cut = s.cuts[cutId]!
  const t = cutTimeline(s, cutId)
  const labels = shotLabels(s)
  const rows = t.items.map((item) => {
    const f = s.frames[item.frameId]!
    const audio = audioLines(f).join(' / ')
    return `| ${labels.get(f.id) ?? ''} | ${cell(f.description)} | ${cell(audio)} | ${cell(f.onScreenText)} | ${item.hidden ? 'hidden' : formatDuration(item.duration)} |`
  })
  return [
    `AV script · "${cut.name}" · ${clock(t.total)}${cut.targetDuration ? ` of ${clock(cut.targetDuration)}` : ''}`,
    '',
    '| Shot | Video | Audio | On screen | Length |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

/** Everything about a project at a glance: brief, bible, cuts, scenes, pages and counts. */
export function describeProject(s: ProjectSnapshot, project: Project, id: string): string {
  const m = s.meta
  const out = [
    `Project "${m.title}" · id ${id} · ${m.type} · ${m.aspect} · ${m.fps} fps · VO pace ${m.wordsPerSecond} words per second`,
  ]
  const brief = s.brief
  out.push('', 'Brief')
  out.push(`  Idea: ${quote(brief.logline) || '(empty)'}`)
  out.push(`  Audience: ${quote(brief.audience) || '(empty)'}`)
  out.push(`  Tone and style: ${quote(brief.tone) || '(empty)'}`)
  out.push(`  Style references: ${brief.styleRefs.length} picture${brief.styleRefs.length === 1 ? '' : 's'}`)

  const labels = shotLabels(s)
  const entries = Object.values(s.bible).sort((a, b) => a.createdAt - b.createdAt)
  out.push('', 'Bible')
  if (!entries.length) out.push('  (empty: no characters, locations or products yet)')
  for (const e of entries) {
    const frames = Object.values(s.frames).filter((f) => f.tags.includes(e.id))
    out.push(
      `  ${e.kind}: ${e.name || 'Unnamed'}${e.description.trim() ? ` — ${clip(quote(e.description), 240)}` : ''} · ${e.assetIds.length} picture${e.assetIds.length === 1 ? '' : 's'} · ${frames.length ? `in ${frames.map((f) => labels.get(f.id) ?? f.id).join(', ')}` : 'not tagged in any frame'}`,
    )
  }

  out.push('', 'Cuts')
  for (const c of Object.values(s.cuts).sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : a.createdAt - b.createdAt))) {
    const t = cutTimeline(s, c.id)
    out.push(
      `  "${c.name}"${c.isMain ? ' (main)' : ''} · ${clock(t.total)}${c.targetDuration ? ` of ${clock(c.targetDuration)} target` : ''} · ${t.items.length} shots${c.music ? ' · has music' : ''}`,
    )
  }

  const scenes = Object.values(s.scenes).sort((a, b) => a.createdAt - b.createdAt)
  if (scenes.length) {
    out.push('', 'Scenes')
    for (const sc of scenes) {
      const frames = Object.values(s.frames).filter((f) => f.sceneId === sc.id)
      out.push(
        `  ${sc.title || 'Untitled'}${[sc.intExt, sc.location, sc.timeOfDay].filter(Boolean).length ? ` (${[sc.intExt, sc.location, sc.timeOfDay].filter(Boolean).join(' · ')})` : ''} · ${frames.map((f) => labels.get(f.id) ?? f.id).join(', ') || 'no frames'}`,
      )
    }
  }

  const pages = Object.values(s.pages).sort((a, b) => a.createdAt - b.createdAt)
  out.push('', `Notes pages: ${pages.map((p) => `"${p.title || 'Untitled'}" (${notesToMarkdown(project.pageFragment(p.id)).length} characters)`).join(', ') || 'none'}`)

  const mood = Object.values(s.moodboard)
  const kinds = (k: string) => mood.filter((i) => i.kind === k).length
  out.push(`Moodboard: ${mood.length ? `${mood.length} items (${kinds('asset')} pictures or links, ${kinds('note')} notes, ${kinds('color')} colours, ${kinds('section')} sections)` : 'empty'}`)

  const assets = Object.values(s.assets)
  const count = (k: string) => assets.filter((a) => a.kind === k).length
  out.push(`Library: ${count('image')} images, ${count('video')} videos, ${count('audio')} audio files, ${count('link')} links`)

  const frames = Object.values(s.frames)
  out.push(`Frames: ${frames.length} in all, ${frames.filter((f) => f.heroMediaId).length} with a picture`)
  const open = Object.values(s.changes).filter((c) => c.status === 'open')
  if (open.length) out.push(`Your open change sets (people can keep or undo them in the app): ${open.length}`)
  return out.join('\n')
}

export function describeMoodboard(s: ProjectSnapshot): string {
  const items = Object.values(s.moodboard).sort((a, b) => a.y - b.y || a.x - b.x)
  if (!items.length) return 'The moodboard is empty.'
  const sections = items.filter((i) => i.kind === 'section')
  const inside = (i: (typeof items)[number], sec: (typeof items)[number]) =>
    i.x + i.w / 2 >= sec.x && i.x + i.w / 2 <= sec.x + sec.w && i.y + i.h / 2 >= sec.y && i.y + i.h / 2 <= sec.y + sec.h
  const line = (i: (typeof items)[number]) => {
    if (i.kind === 'note') return `note: ${quote(i.text) || '(empty)'}`
    if (i.kind === 'color') return `colour ${i.color.toUpperCase()}`
    const a = i.assetId ? s.assets[i.assetId] : undefined
    if (!a) return 'missing item'
    if (a.kind === 'link') return `link: ${a.title && a.title !== a.url ? `${a.title} ` : ''}${a.url ?? ''}`
    return `${a.kind}: ${a.title || a.name || a.id}`
  }
  const out: string[] = []
  for (const sec of sections) {
    out.push(`Section "${quote(sec.text) || 'Untitled'}"`)
    for (const i of items) if (i.kind !== 'section' && inside(i, sec)) out.push(`  ${line(i)}`)
  }
  const loose = items.filter((i) => i.kind !== 'section' && !sections.some((sec) => inside(i, sec)))
  if (loose.length) {
    if (sections.length) out.push('Outside sections')
    for (const i of loose) out.push(`  ${line(i)}`)
  }
  return out.join('\n')
}

/** Text matches across frames, the bible, the brief, notes and the moodboard. */
export function searchProject(s: ProjectSnapshot, project: Project, query: string): string {
  const q = norm(query)
  if (!q) throw new AgentError('Search for something')
  const hits: string[] = []
  const around = (text: string) => {
    const flat = quote(text)
    const at = flat.toLowerCase().indexOf(q)
    if (at < 0) return null
    const start = Math.max(0, at - 50)
    return `${start ? '…' : ''}${flat.slice(start, at + q.length + 70)}${at + q.length + 70 < flat.length ? '…' : ''}`
  }
  const labels = shotLabels(s)
  for (const f of Object.values(s.frames)) {
    const fields: Array<[string, string]> = [
      ['video', f.description],
      ['on screen', f.onScreenText],
      ['notes', f.notes],
      ['motion notes', f.motionNotes],
      ...f.audio.map((l): [string, string] => [l.kind === 'vo' ? 'VO' : l.speaker || 'dialogue', l.text]),
    ]
    for (const [field, text] of fields) {
      const hit = around(text)
      if (hit) hits.push(`Frame ${labels.get(f.id) ?? f.id} (${field}): ${hit}`)
    }
  }
  for (const e of Object.values(s.bible)) {
    const hit = around(`${e.name} ${e.description}`)
    if (hit) hits.push(`Bible ${e.kind} ${e.name}: ${hit}`)
  }
  for (const [field, text] of [
    ['idea', s.brief.logline],
    ['audience', s.brief.audience],
    ['tone', s.brief.tone],
  ] as const) {
    const hit = around(text)
    if (hit) hits.push(`Brief (${field}): ${hit}`)
  }
  for (const p of Object.values(s.pages)) {
    for (const para of notesToMarkdown(project.pageFragment(p.id)).split(/\n+/)) {
      const hit = around(para)
      if (hit) hits.push(`Notes "${p.title || 'Untitled'}": ${hit}`)
    }
  }
  for (const i of Object.values(s.moodboard)) {
    const hit = around(i.text)
    if (hit) hits.push(`Moodboard ${i.kind}: ${hit}`)
  }
  for (const a of Object.values(s.assets)) {
    const hit = around(`${a.name} ${a.title} ${a.url ?? ''}`)
    if (hit) hits.push(`Library ${a.kind}: ${hit}`)
  }
  return hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}":\n${hits.slice(0, 80).join('\n')}` : `Nothing matches "${query}".`
}
