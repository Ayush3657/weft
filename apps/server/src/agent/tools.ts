import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ASPECT_RATIOS,
  BIBLE_KINDS,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  SHOT_SIZES,
  TRANSITIONS,
  WeftError,
  applyTextDiff,
  appendFrames,
  aspectValue,
  cutTimeline,
  formatSeconds,
  notesToMarkdown,
  scriptMarkdown,
  shotLabels,
  type AudioLineInit,
  type CameraAngle,
  type CameraMove,
  type FrameInit,
  type FramePatch,
  type Project,
  type ProjectSnapshot,
  type ShotSize,
  type TransitionType,
} from '@weft/model'
import { z } from 'zod'
import type { PublicUser } from '../auth'
import { config } from '../config'
import { getMedia, mediaFile, storeMediaBuffer } from '../media'
import { createProject, listProjects, type ProjectSummary } from '../projects'
import { downloadPublic, unfurl } from '../unfurl'
import { describeCut, describeFrame, describeMoodboard, describeProject, resolveCut, resolveEntry, resolveFrame, resolvePage, searchProject } from './describe'
import { contactSheet, imageSize, previewJpeg } from './images'
import { AgentError, sessionFor, type AgentSession } from './session'

// ------------------------------------------------------------------ helpers

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type Result = { content: Content[]; isError?: boolean }

const text = (value: string): Result => ({ content: [{ type: 'text', text: value }] })

/** Mistakes come back to Claude as a readable message it can act on, not a protocol error. */
function guarded<A>(run: (args: A) => Promise<Result> | Result) {
  return async (args: A): Promise<Result> => {
    try {
      return await run(args)
    } catch (error) {
      const message = error instanceof AgentError || error instanceof WeftError ? error.message : `Something went wrong: ${(error as Error).message}`
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}

const norm = (s: string) => s.trim().toLowerCase()
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const labelsOf = (s: ProjectSnapshot, ids: readonly string[]) => {
  const labels = shotLabels(s)
  return ids.map((id) => labels.get(id) ?? id).join(', ')
}

function findProject(ref: string): ProjectSummary {
  const all = listProjects()
  const exact = all.find((p) => p.id === ref) ?? all.find((p) => norm(p.title) === norm(ref))
  if (exact) return exact
  const partial = all.filter((p) => norm(p.title).includes(norm(ref)))
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) throw new AgentError(`"${ref}" matches several projects: ${partial.map((p) => `"${p.title}" (${p.id})`).join(', ')}. Use the id.`)
  throw new AgentError(`No project "${ref}". Call list_projects to see them.`)
}

const ids = <T extends { id: string }>(options: readonly T[]) => options.map((o) => o.id) as unknown as [T['id'], ...T['id'][]]
const listed = (options: ReadonlyArray<{ id: string; label: string }>) => options.map((o) => `${o.id} (${o.label})`).join(', ')

// ---------------------------------------------------------------- schemas

const projectArg = z.string().describe('Project id or title, from list_projects.')
const cutArg = z.string().optional().describe('Cut name or id. Defaults to the main cut.')
const frameRef = z.string().describe('A shot number like "3" or "12B" (from get_cut), or a frame id.')

const frameFields = {
  description: z.string().optional().describe('What we see: the action, framing and key details, in a sentence or two.'),
  vo: z.string().optional().describe('The voiceover for this shot, replacing the existing VO. An empty string removes it.'),
  dialogue: z
    .array(z.object({ speaker: z.string(), text: z.string() }))
    .optional()
    .describe('Lines spoken on screen, replacing the existing dialogue.'),
  on_screen_text: z.string().optional().describe('Supers, titles and CTA text.'),
  shot: z.enum(ids(SHOT_SIZES)).nullable().optional().describe(`Shot size: ${listed(SHOT_SIZES)}.`),
  angle: z.enum(ids(CAMERA_ANGLES)).nullable().optional().describe(`Camera angle: ${listed(CAMERA_ANGLES)}.`),
  movement: z.enum(ids(CAMERA_MOVES)).nullable().optional().describe(`Camera movement: ${listed(CAMERA_MOVES)}.`),
  lens: z.string().nullable().optional().describe('Lens, e.g. "35mm".'),
  seconds: z
    .number()
    .positive()
    .max(600)
    .nullable()
    .optional()
    .describe('A fixed length in seconds. Leave it out to time the shot from its VO; null switches back to that.'),
  notes: z.string().optional().describe('Notes for the team: image prompts, props, performance, references.'),
  motion_notes: z.string().optional().describe('For motion graphics: how things move or animate.'),
  in_shot: z
    .array(z.string())
    .optional()
    .describe('Names of bible entries (characters, locations, products) in this shot, replacing the current tags. Add entries first with upsert_bible_entry.'),
  scene: z.string().nullable().optional().describe('Scene title. A new title creates the scene; null takes the frame out of its scene.'),
  status: z.enum(['idea', 'draft', 'approved']).optional(),
}
const frameObject = z.object(frameFields)
type FrameFields = z.infer<typeof frameObject>

function sceneId(project: Project, s: ProjectSnapshot, title: string | null): string | null {
  if (title === null) return null
  const found = Object.values(s.scenes).find((sc) => norm(sc.title) === norm(title))
  return found ? found.id : project.createScene({ title })
}

function tagIds(s: ProjectSnapshot, names: readonly string[], warnings: string[]): string[] {
  const out: string[] = []
  for (const name of names) {
    const entry = resolveEntry(s, name)
    if (entry) out.push(entry.id)
    else warnings.push(`There's no bible entry called "${name}", so it wasn't tagged. Add it with upsert_bible_entry.`)
  }
  return out
}

/** Frame fields as the model's frame init, for new frames. */
function toInit(project: Project, s: ProjectSnapshot, f: FrameFields, warnings: string[]): FrameInit {
  const init: FrameInit = {}
  if (f.description !== undefined) init.description = f.description
  if (f.on_screen_text !== undefined) init.onScreenText = f.on_screen_text
  if (f.notes !== undefined) init.notes = f.notes
  if (f.motion_notes !== undefined) init.motionNotes = f.motion_notes
  const audio: AudioLineInit[] = []
  if (f.vo) audio.push({ kind: 'vo', text: f.vo })
  for (const d of f.dialogue ?? []) audio.push({ kind: 'dialogue', speaker: d.speaker, text: d.text })
  if (audio.length) init.audio = audio
  if (f.shot !== undefined) init.shotSize = f.shot as ShotSize | null
  if (f.angle !== undefined) init.angle = f.angle as CameraAngle | null
  if (f.movement !== undefined) init.movement = f.movement as CameraMove | null
  if (f.lens !== undefined) init.lens = f.lens
  if (typeof f.seconds === 'number') {
    init.durationMode = 'manual'
    init.duration = f.seconds
  }
  if (f.in_shot) init.tags = tagIds(s, f.in_shot, warnings)
  if (f.scene !== undefined) init.sceneId = sceneId(project, s, f.scene)
  if (f.status) init.status = f.status
  return init
}

/** Frame fields applied to an existing frame. Returns the names of what changed. */
function applyFields(project: Project, s: ProjectSnapshot, frameId: string, f: FrameFields, warnings: string[]): string[] {
  const changed: string[] = []
  const frame = project.getFrame(frameId)!
  const setText = (field: 'description' | 'onScreenText' | 'notes' | 'motionNotes', value: string | undefined, name: string) => {
    if (value === undefined) return
    project.setText(frameId, field, value)
    changed.push(name)
  }
  setText('description', f.description, 'description')
  setText('onScreenText', f.on_screen_text, 'on-screen text')
  setText('notes', f.notes, 'notes')
  setText('motionNotes', f.motion_notes, 'motion notes')
  if (f.vo !== undefined) {
    const vo = frame.audio.filter((l) => l.kind === 'vo')
    if (!f.vo) {
      for (const line of vo) project.removeAudioLine(frameId, line.id)
    } else if (vo[0]) {
      if (vo[0].text !== f.vo) {
        project.setAudioText(frameId, vo[0].id, f.vo)
        // A recording of the old words no longer fits, and would keep the old timing.
        if (vo[0].assetId) project.setAudioAsset(frameId, vo[0].id, null)
      }
    } else {
      project.addAudioLine(frameId, { kind: 'vo', text: f.vo })
    }
    changed.push('VO')
  }
  if (f.dialogue !== undefined) {
    for (const line of frame.audio) if (line.kind === 'dialogue') project.removeAudioLine(frameId, line.id)
    for (const d of f.dialogue) project.addAudioLine(frameId, { kind: 'dialogue', speaker: d.speaker, text: d.text })
    changed.push('dialogue')
  }
  const patch: FramePatch = {}
  if (f.shot !== undefined) patch.shotSize = f.shot as ShotSize | null
  if (f.angle !== undefined) patch.angle = f.angle as CameraAngle | null
  if (f.movement !== undefined) patch.movement = f.movement as CameraMove | null
  if (f.lens !== undefined) patch.lens = f.lens
  if (f.status !== undefined) patch.status = f.status
  if (f.scene !== undefined) patch.sceneId = sceneId(project, s, f.scene)
  if (Object.keys(patch).length) {
    project.updateFrame(frameId, patch)
    if (patch.shotSize !== undefined || patch.angle !== undefined || patch.movement !== undefined || patch.lens !== undefined) changed.push('camera')
    if (patch.status !== undefined) changed.push('status')
    if (patch.sceneId !== undefined) changed.push('scene')
  }
  if (f.seconds !== undefined) {
    if (f.seconds === null) project.resetDuration(frameId)
    else project.setDuration(frameId, f.seconds)
    changed.push('length')
  }
  if (f.in_shot !== undefined) {
    project.setTags(frameId, tagIds(s, f.in_shot, warnings))
    changed.push('tags')
  }
  return changed
}

const cutLength = (s: ProjectSnapshot, cutId: string) => {
  const cut = s.cuts[cutId]!
  const total = cutTimeline(s, cutId).total
  return `"${cut.name}" now runs ${formatSeconds(total)}${cut.targetDuration ? ` of its ${formatSeconds(cut.targetDuration)} target` : ''}.`
}

const withWarnings = (message: string, warnings: readonly string[]) => (warnings.length ? `${message}\n${warnings.join('\n')}` : message)

const MEDIA_TYPES = /^(image|video|audio)\/[a-z0-9.+-]+$/

// ------------------------------------------------------------------- server

const INSTRUCTIONS = `Weft is a storyboarding app for ads and films. You're working in someone's project, live: every edit you make appears for everyone who has it open, and they can keep or undo your changes from a bar in the app (or ask you to use undo_changes).

How a project is organised:
- Frames are shots. Each has a description (what we see), VO and dialogue, on-screen text, camera (shot size, angle, movement, lens), a length, tags for who and what is in the shot (from the bible), and a picture.
- Frames are joined by links into a sequence. A frame can have variations: alternatives that fork from the same place and merge back. Shot numbers like 12B show variations.
- A cut is one path through the frames (choosing a variation at each fork), with its own target length, lengths set for that cut, and hidden frames. The main cut is the default.
- A frame's length comes from its VO at the project's VO pace (words per second) unless it's set in seconds.
- The bible holds the brief (idea, audience, tone), characters, locations and products. Notes pages are free text; the moodboard collects pictures, links, notes and colours.

Working well:
- Read before you write: get_project for the brief and bible, then get_cut or get_script, and view_frames to see the pictures.
- Keep each cut close to its target length; check the new length after changes.
- For an alternative take on a shot, use add_variation rather than overwriting it, especially for approved frames.
- Ask before deleting frames. Refer to frames by shot number or id.
- Pictures come from people or from attach_media (for example a Blender render saved on this computer).`

const NOT_CONNECTED =
  "Weft isn't connected to your account yet. In Weft, open your account menu, choose Connect Claude, then Connect Claude on this computer. Then try again; Claude doesn't need restarting."

/**
 * Weft's tools for one caller. Without a key (`caller` null) Claude can still
 * see the tools, and each one explains how to connect.
 */
export function createAgentServer(caller: PublicUser | null, reason: string = NOT_CONNECTED): McpServer {
  const server = new McpServer({ name: 'weft', title: 'Weft', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const me = (): PublicUser => {
    if (!caller) throw new AgentError(reason)
    return caller
  }

  const open = async (ref: string): Promise<{ session: AgentSession; s: ProjectSnapshot; id: string; title: string }> => {
    const user = me()
    const summary = findProject(ref)
    const session = await sessionFor(summary.id, user)
    return { session, s: session.snapshot(), id: summary.id, title: summary.title }
  }

  // --------------------------------------------------------------- reading

  server.registerTool(
    'list_projects',
    { title: 'List projects', description: 'All projects on this Weft server, newest first.', annotations: { readOnlyHint: true } },
    guarded(async () => {
      me()
      const all = listProjects()
      if (!all.length) return text('There are no projects yet. Make one with create_project.')
      return text(
        all
          .map((p) => `"${p.title}" · id ${p.id} · ${p.type} · updated ${new Date(p.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}`)
          .join('\n'),
      )
    }),
  )

  server.registerTool(
    'get_project',
    {
      title: 'Project overview',
      description: 'The brief, bible (characters, locations, products), cuts with their lengths, scenes, notes pages, moodboard and library at a glance. Start here.',
      inputSchema: { project: projectArg },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project }) => {
      const { session, s, id } = await open(project)
      return text(describeProject(s, session.project, id))
    }),
  )

  server.registerTool(
    'get_cut',
    {
      title: 'Frames in a cut',
      description: 'The frames of a cut in order: shot numbers, timings, what we see and hear, camera, tags, transitions and the variations available at each point.',
      inputSchema: { project: projectArg, cut: cutArg },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, cut }) => {
      const { s } = await open(project)
      return text(describeCut(s, resolveCut(s, cut)))
    }),
  )

  server.registerTool(
    'get_frames',
    {
      title: 'Frame details',
      description: 'Everything about particular frames, including notes, motion notes, references and lengths set per cut.',
      inputSchema: { project: projectArg, frames: z.array(frameRef).min(1).max(50), cut: cutArg },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, frames, cut }) => {
      const { s } = await open(project)
      const t = cutTimeline(s, resolveCut(s, cut))
      return text(frames.map((ref) => resolveFrame(s, ref)).map((id) => describeFrame(s, id, { item: t.byFrame.get(id), full: true })).join('\n\n'))
    }),
  )

  server.registerTool(
    'get_script',
    {
      title: 'AV script',
      description: 'A cut as a two-column AV script (video, audio, on-screen text, length), as a Markdown table.',
      inputSchema: { project: projectArg, cut: cutArg },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, cut }) => {
      const { s } = await open(project)
      return text(scriptMarkdown(s, resolveCut(s, cut)))
    }),
  )

  server.registerTool(
    'get_notes',
    {
      title: 'Notes pages',
      description: 'Notes pages as Markdown. Without a page, every page (long projects: just their titles and the first page).',
      inputSchema: { project: projectArg, page: z.string().optional().describe('Page title or id.') },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, page }) => {
      const { session, s } = await open(project)
      const pages = Object.values(s.pages).sort((a, b) => a.createdAt - b.createdAt)
      if (!pages.length) return text('This project has no notes pages yet.')
      const render = (id: string) => `# ${s.pages[id]!.title || 'Untitled'}\n\n${notesToMarkdown(session.project.pageFragment(id)) || '(empty)'}`
      if (page) {
        const id = resolvePage(s, page)
        if (!id) throw new AgentError(`No page "${page}". Pages: ${pages.map((p) => `"${p.title || 'Untitled'}"`).join(', ')}.`)
        return text(render(id))
      }
      const all = pages.map((p) => render(p.id)).join('\n\n---\n\n')
      if (all.length <= 24_000) return text(all)
      return text(`Pages: ${pages.map((p) => `"${p.title || 'Untitled'}"`).join(', ')}\n\n${render(pages[0]!.id)}`)
    }),
  )

  server.registerTool(
    'get_moodboard',
    {
      title: 'Moodboard',
      description: 'What is on the moodboard, section by section: pictures, links, notes and colours.',
      inputSchema: { project: projectArg },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project }) => {
      const { s } = await open(project)
      return text(describeMoodboard(s))
    }),
  )

  server.registerTool(
    'view_frames',
    {
      title: 'Look at frames',
      description:
        "See the frames' pictures. Without `frames`, the whole cut as a contact sheet, marked with shot numbers (frames without a picture show their description). With `frames`, each one larger.",
      inputSchema: { project: projectArg, cut: cutArg, frames: z.array(frameRef).max(8).optional() },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, cut, frames }) => {
      const { s } = await open(project)
      const labels = shotLabels(s)
      const heroHash = (frameId: string) => {
        const f = s.frames[frameId]!
        const hero = f.media.find((m) => m.id === f.heroMediaId)
        const asset = hero ? s.assets[hero.assetId] : undefined
        return asset?.kind === 'image' ? asset.hash : null
      }
      const content: Content[] = []
      if (frames?.length) {
        for (const id of frames.map((ref) => resolveFrame(s, ref))) {
          const hash = heroHash(id)
          const jpeg = hash ? await previewJpeg(hash, 1024) : null
          content.push({ type: 'text', text: `${labels.get(id) ?? id}: ${jpeg ? 'picture below' : 'no still picture (none yet, or a video)'}. ${s.frames[id]!.description}` })
          if (jpeg) content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
        }
        return { content }
      }
      const cutId = resolveCut(s, cut)
      const items = cutTimeline(s, cutId).items
      if (!items.length) return text('This cut has no frames yet.')
      const cells = items.map((item) => ({
        hash: heroHash(item.frameId),
        label: labels.get(item.frameId) ?? '?',
        caption: s.frames[item.frameId]!.description,
      }))
      const aspect = aspectValue(s.meta.aspect)
      for (let i = 0; i < cells.length; i += 24) {
        const sheet = await contactSheet(cells.slice(i, i + 24), aspect)
        content.push({ type: 'image', data: sheet.toString('base64'), mimeType: 'image/jpeg' })
      }
      const withPictures = cells.filter((c) => c.hash).length
      content.unshift({
        type: 'text',
        text: `"${s.cuts[cutId]!.name}": ${plural(cells.length, 'frame')} left to right, top to bottom; ${withPictures} with pictures.`,
      })
      return { content }
    }),
  )

  server.registerTool(
    'view_pictures',
    {
      title: 'Look at reference pictures',
      description: "See the pictures attached to a frame's references, a bible entry, the brief's style references, or the moodboard.",
      inputSchema: {
        project: projectArg,
        of: z.enum(['frame_references', 'bible_entry', 'style', 'moodboard']),
        frame: frameRef.optional(),
        entry: z.string().optional().describe('Bible entry name, for of = bible_entry.'),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, of, frame, entry }) => {
      const { s } = await open(project)
      let assetIds: string[]
      if (of === 'frame_references') {
        if (!frame) throw new AgentError('Say which frame')
        assetIds = s.frames[resolveFrame(s, frame)]!.references
      } else if (of === 'bible_entry') {
        const found = entry ? resolveEntry(s, entry) : null
        if (!found) throw new AgentError(`No bible entry "${entry ?? ''}"`)
        assetIds = found.assetIds
      } else if (of === 'style') {
        assetIds = s.brief.styleRefs
      } else {
        assetIds = Object.values(s.moodboard).flatMap((i) => (i.assetId ? [i.assetId] : []))
      }
      const content: Content[] = []
      for (const id of assetIds.slice(0, 10)) {
        const a = s.assets[id]
        if (!a) continue
        const jpeg = a.kind === 'image' && a.hash ? await previewJpeg(a.hash, 768) : null
        content.push({ type: 'text', text: `${a.kind}: ${a.title || a.name || a.url || id}${a.url ? ` (${a.url})` : ''}` })
        if (jpeg) content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
      }
      if (!content.length) return text('No pictures there yet.')
      if (assetIds.length > 10) content.push({ type: 'text', text: `…and ${assetIds.length - 10} more.` })
      return { content }
    }),
  )

  server.registerTool(
    'search',
    {
      title: 'Search a project',
      description: 'Find text across frames (description, VO, dialogue, on-screen text, notes), the brief, bible, notes pages, moodboard and library.',
      inputSchema: { project: projectArg, query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ project, query }) => {
      const { session, s } = await open(project)
      return text(searchProject(s, session.project, query))
    }),
  )

  // --------------------------------------------------------------- writing

  server.registerTool(
    'create_project',
    {
      title: 'New project',
      description: 'Makes a new project with one empty frame. For ads, set the target length in seconds.',
      inputSchema: {
        title: z.string().min(1).max(200),
        type: z.enum(['ad', 'film', 'other']),
        aspect: z.enum(ASPECT_RATIOS as unknown as [string, ...string[]]).optional().describe('Defaults to 16:9.'),
        target_seconds: z.number().positive().max(36000).optional(),
      },
    },
    guarded(async ({ title, type, aspect, target_seconds }) => {
      const project = createProject(me().id, {
        title,
        type,
        ...(aspect ? { aspect: aspect as (typeof ASPECT_RATIOS)[number] } : {}),
        ...(target_seconds ? { targetDuration: target_seconds } : {}),
      })
      return text(`Made "${project.title}" (id ${project.id}). It's open for everyone at ${config.appUrl}/p/${project.id}.`)
    }),
  )

  server.registerTool(
    'create_frames',
    {
      title: 'Add frames',
      description:
        "Adds frames to a cut, in order: at the end, or after a given frame. A new project's empty first frame is used for the first one. Leave out `seconds` to time each shot from its VO.",
      inputSchema: {
        project: projectArg,
        cut: cutArg,
        after: frameRef.optional().describe('Put the new frames after this one. Default: the end of the cut.'),
        frames: z.array(frameObject).min(1).max(100),
      },
    },
    guarded(async ({ project, cut, after, frames }) => {
      const { session, s } = await open(project)
      const cutId = resolveCut(s, cut)
      const afterId = after ? resolveFrame(s, after) : undefined
      const warnings: string[] = []
      const { result } = session.edit(
        () => appendFrames(session.project, cutId, frames.map((f) => toInit(session.project, s, f, warnings)), afterId ? { after: afterId } : {}),
        (added) => ({ line: `Added ${added.length === 1 ? 'frame' : 'frames'} ${labelsOf(session.project.snapshot(), added)}`, frames: added }),
      )
      const now = session.snapshot()
      return text(
        withWarnings(
          `Added ${plural(result.length, 'frame')}: ${result.map((id) => `${shotLabels(now).get(id) ?? '?'} (id ${id})`).join(', ')}. ${cutLength(now, cutId)}`,
          warnings,
        ),
      )
    }),
  )

  server.registerTool(
    'update_frames',
    {
      title: 'Change frames',
      description: 'Changes fields of existing frames. Only the fields you give change; text replaces the old text.',
      inputSchema: {
        project: projectArg,
        updates: z
          .array(z.object({ frame: frameRef, ...frameFields }))
          .min(1)
          .max(100),
      },
    },
    guarded(async ({ project, updates }) => {
      const { session, s } = await open(project)
      const targets = updates.map((u) => ({ id: resolveFrame(s, u.frame), fields: u }))
      const warnings: string[] = []
      const { result } = session.edit(
        () => targets.map((t) => ({ id: t.id, changed: applyFields(session.project, s, t.id, t.fields, warnings) })),
        (done) => {
          const fields = [...new Set(done.flatMap((d) => d.changed))]
          const which = done.map((d) => d.id)
          return {
            line: `Changed ${fields.length ? fields.join(', ') : 'nothing'} in ${which.length === 1 ? 'frame' : 'frames'} ${labelsOf(session.project.snapshot(), which)}`,
            frames: which,
          }
        },
      )
      const now = session.snapshot()
      return text(withWarnings(`Updated ${plural(result.length, 'frame')}. ${cutLength(now, now.meta.mainCutId)}`, warnings))
    }),
  )

  server.registerTool(
    'delete_frames',
    {
      title: 'Delete frames',
      description: 'Deletes frames. The frames around each one are joined up again. Ask the person first; to leave a shot out of one version, hide it with set_cut instead.',
      inputSchema: { project: projectArg, frames: z.array(frameRef).min(1).max(100) },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ project, frames }) => {
      const { session, s } = await open(project)
      const targets = frames.map((ref) => resolveFrame(s, ref))
      const names = labelsOf(s, targets)
      session.edit(
        () => session.project.deleteFrames(targets),
        () => ({ line: `Deleted ${targets.length === 1 ? 'frame' : 'frames'} ${names}` }),
      )
      return text(`Deleted ${names}. ${cutLength(session.snapshot(), s.meta.mainCutId)}`)
    }),
  )

  server.registerTool(
    'add_variation',
    {
      title: 'Add a variation',
      description:
        'Adds an alternative to a frame: it forks from the same place and merges back, starting as a copy with your changes. By default the cut switches to use it; people can switch back.',
      inputSchema: {
        project: projectArg,
        frame: frameRef,
        changes: frameObject.optional(),
        use_in_cut: z.boolean().optional().describe('Make the cut use the new variation (default true).'),
        cut: cutArg,
      },
    },
    guarded(async ({ project, frame, changes, use_in_cut, cut }) => {
      const { session, s } = await open(project)
      const frameId = resolveFrame(s, frame)
      const cutId = resolveCut(s, cut)
      const warnings: string[] = []
      const { result } = session.edit(
        () => {
          const id = session.project.addVariation(frameId)
          if (changes) applyFields(session.project, s, id, changes, warnings)
          if (use_in_cut !== false) session.project.routeThrough(cutId, id)
          return id
        },
        (id) => ({ line: `Added variation ${labelsOf(session.project.snapshot(), [id])} of ${labelsOf(s, [frameId])}`, frames: [id] }),
      )
      const now = session.snapshot()
      return text(
        withWarnings(
          `Added variation ${shotLabels(now).get(result) ?? result} (id ${result})${use_in_cut !== false ? `, now used in "${now.cuts[cutId]!.name}"` : ''}. ${cutLength(now, cutId)}`,
          warnings,
        ),
      )
    }),
  )

  server.registerTool(
    'link_frames',
    {
      title: 'Link frames',
      description: 'Connects one frame to the next (or changes or removes that link), with a transition.',
      inputSchema: {
        project: projectArg,
        from: frameRef,
        to: frameRef,
        transition: z.enum(ids(TRANSITIONS)).optional().describe(`${listed(TRANSITIONS)}.`),
        transition_seconds: z.number().positive().max(10).optional(),
        note: z.string().optional(),
        remove: z.boolean().optional().describe('Remove the link instead.'),
      },
    },
    guarded(async ({ project, from, to, transition, transition_seconds, note, remove }) => {
      const { session, s } = await open(project)
      const a = resolveFrame(s, from)
      const b = resolveFrame(s, to)
      const existing = Object.values(s.links).find((l) => l.from === a && l.to === b)
      const names = `${labelsOf(s, [a])} → ${labelsOf(s, [b])}`
      if (remove) {
        if (!existing) throw new AgentError(`${names} aren't linked`)
        session.edit(() => session.project.deleteLink(existing.id), () => ({ line: `Unlinked ${names}`, frames: [a, b] }))
        return text(`Unlinked ${names}.`)
      }
      const patch = {
        ...(transition ? { transition: transition as TransitionType, transitionDuration: transition === 'cut' ? 0 : (transition_seconds ?? 0.5) } : {}),
        ...(transition_seconds && !transition ? { transitionDuration: transition_seconds } : {}),
        ...(note !== undefined ? { note } : {}),
      }
      session.edit(
        () => (existing ? session.project.updateLink(existing.id, patch) : session.project.linkFrames(a, b, patch)),
        () => ({ line: `${existing ? 'Changed the link' : 'Linked'} ${names}`, frames: [a, b] }),
      )
      return text(`${existing ? 'Changed the link' : 'Linked'} ${names}.`)
    }),
  )

  server.registerTool(
    'set_timing',
    {
      title: 'Set lengths',
      description:
        "Sets frame lengths in seconds. By default only for this cut (other cuts keep theirs), which is right for cutdowns; null goes back to the frame's own length. Can also set the cut's target length.",
      inputSchema: {
        project: projectArg,
        cut: cutArg,
        lengths: z
          .array(z.object({ frame: frameRef, seconds: z.number().positive().max(600).nullable() }))
          .max(200)
          .optional(),
        this_cut_only: z.boolean().optional().describe('Default true. False changes the frames themselves, in every cut.'),
        target_seconds: z.number().positive().max(36000).nullable().optional(),
      },
    },
    guarded(async ({ project, cut, lengths = [], this_cut_only, target_seconds }) => {
      const { session, s } = await open(project)
      const cutId = resolveCut(s, cut)
      const targets = lengths.map((l) => ({ id: resolveFrame(s, l.frame), seconds: l.seconds }))
      const cutOnly = this_cut_only !== false
      session.edit(
        () => {
          for (const t of targets) {
            if (cutOnly) session.project.setOverride(cutId, t.id, t.seconds)
            else if (t.seconds === null) session.project.resetDuration(t.id)
            else session.project.setDuration(t.id, t.seconds)
          }
          if (target_seconds !== undefined) session.project.setCutTarget(cutId, target_seconds)
        },
        () => ({
          line: `Retimed ${plural(targets.length, 'frame')}${cutOnly ? ` in "${s.cuts[cutId]!.name}"` : ''}${target_seconds !== undefined ? ', and set the target length' : ''}`,
          frames: targets.map((t) => t.id),
        }),
      )
      return text(cutLength(session.snapshot(), cutId))
    }),
  )

  server.registerTool(
    'create_scene',
    {
      title: 'Add a scene',
      description: 'Adds a scene (a group of frames in one place and time) and optionally puts frames in it.',
      inputSchema: {
        project: projectArg,
        title: z.string().min(1),
        int_ext: z.enum(['INT', 'EXT', 'INT/EXT']).optional(),
        location: z.string().optional(),
        time_of_day: z.string().optional(),
        frames: z.array(frameRef).optional(),
      },
    },
    guarded(async ({ project, title, int_ext, location, time_of_day, frames = [] }) => {
      const { session, s } = await open(project)
      const targets = frames.map((ref) => resolveFrame(s, ref))
      session.edit(
        () => {
          const id = session.project.createScene({ title, ...(int_ext ? { intExt: int_ext } : {}), ...(location ? { location } : {}), ...(time_of_day ? { timeOfDay: time_of_day } : {}) })
          if (targets.length) session.project.assignScene(targets, id)
          return id
        },
        () => ({ line: `Added scene "${title}"`, frames: targets }),
      )
      return text(`Added scene "${title}"${targets.length ? ` with ${labelsOf(s, targets)}` : ''}.`)
    }),
  )

  server.registerTool(
    'create_cut',
    {
      title: 'New cut',
      description: 'Makes a new cut (another version, like a 15s cutdown), starting as a copy of an existing cut.',
      inputSchema: {
        project: projectArg,
        name: z.string().min(1).max(80),
        from_cut: cutArg,
        target_seconds: z.number().positive().max(36000).optional(),
      },
    },
    guarded(async ({ project, name, from_cut, target_seconds }) => {
      const { session, s } = await open(project)
      const source = resolveCut(s, from_cut)
      const { result } = session.edit(
        () => {
          const id = session.project.createCut(name, { copyFrom: source })
          if (target_seconds) session.project.setCutTarget(id, target_seconds)
          return id
        },
        () => ({ line: `Made cut "${name}" from "${s.cuts[source]!.name}"` }),
      )
      return text(`Made "${name}" (id ${result}). ${cutLength(session.snapshot(), result)}`)
    }),
  )

  server.registerTool(
    'set_cut',
    {
      title: 'Change a cut',
      description: 'Changes which frames a cut plays: use particular variations, hide or show frames, pick the first frame, rename it or set its target length.',
      inputSchema: {
        project: projectArg,
        cut: cutArg,
        use: z.array(frameRef).optional().describe('Frames (usually variations) the cut should go through.'),
        hide: z.array(frameRef).optional(),
        show: z.array(frameRef).optional(),
        start: frameRef.optional().describe('Frame the cut starts from.'),
        rename: z.string().min(1).max(80).optional(),
        target_seconds: z.number().positive().max(36000).nullable().optional(),
      },
    },
    guarded(async ({ project, cut, use = [], hide = [], show = [], start, rename, target_seconds }) => {
      const { session, s } = await open(project)
      const cutId = resolveCut(s, cut)
      const useIds = use.map((ref) => resolveFrame(s, ref))
      const hideIds = hide.map((ref) => resolveFrame(s, ref))
      const showIds = show.map((ref) => resolveFrame(s, ref))
      const startId = start ? resolveFrame(s, start) : undefined
      session.edit(
        () => {
          if (startId) session.project.setCutStart(cutId, startId)
          for (const id of useIds) session.project.routeThrough(cutId, id)
          for (const id of hideIds) session.project.setHidden(cutId, id, true)
          for (const id of showIds) session.project.setHidden(cutId, id, false)
          if (rename) session.project.renameCut(cutId, rename)
          if (target_seconds !== undefined) session.project.setCutTarget(cutId, target_seconds)
        },
        () => ({ line: `Changed cut "${rename ?? s.cuts[cutId]!.name}"`, frames: [...useIds, ...hideIds, ...showIds] }),
      )
      return text(cutLength(session.snapshot(), cutId))
    }),
  )

  server.registerTool(
    'upsert_bible_entry',
    {
      title: 'Add or update a bible entry',
      description: 'Adds a character, location or product to the bible, or updates the one with that name.',
      inputSchema: {
        project: projectArg,
        kind: z.enum(BIBLE_KINDS as unknown as ['character', 'location', 'product']),
        name: z.string().min(1).max(120),
        description: z.string().optional().describe('Look, personality, wardrobe, voice; or place, mood, time of day; or product details.'),
        rename_to: z.string().min(1).max(120).optional(),
      },
    },
    guarded(async ({ project, kind, name, description, rename_to }) => {
      const { session, s } = await open(project)
      const existing = resolveEntry(s, name)
      session.edit(
        () => {
          const id = existing?.id ?? session.project.createBibleEntry(kind, { name })
          if (existing && (existing.kind !== kind || rename_to)) session.project.updateBibleEntry(id, { kind, ...(rename_to ? { name: rename_to } : {}) })
          if (!existing && rename_to) session.project.updateBibleEntry(id, { name: rename_to })
          if (description !== undefined) applyTextDiff(session.project.bibleText(id), description)
          return id
        },
        () => ({ line: `${existing ? 'Updated' : 'Added'} ${rename_to ?? name} ${existing ? 'in' : 'to'} the bible` }),
      )
      return text(`${existing ? 'Updated' : 'Added'} ${kind} "${rename_to ?? name}".`)
    }),
  )

  server.registerTool(
    'update_brief',
    {
      title: 'Update the brief',
      description: "Sets the brief's idea (logline), audience, and tone and style. Only the fields you give change.",
      inputSchema: { project: projectArg, idea: z.string().optional(), audience: z.string().optional(), tone: z.string().optional() },
    },
    guarded(async ({ project, idea, audience, tone }) => {
      const { session } = await open(project)
      session.edit(
        () => {
          if (idea !== undefined) applyTextDiff(session.project.briefText('logline'), idea)
          if (audience !== undefined) applyTextDiff(session.project.briefText('audience'), audience)
          if (tone !== undefined) applyTextDiff(session.project.briefText('tone'), tone)
        },
        () => ({ line: 'Updated the brief' }),
      )
      return text('Updated the brief.')
    }),
  )

  server.registerTool(
    'attach_media',
    {
      title: 'Attach a picture or clip',
      description:
        "Adds an image, video or audio file to a frame (as its picture or a reference), a bible entry, the brief's style references, or the moodboard. Give `path` for a file on this computer (for example a Blender render) or `url` for one on the web.",
      inputSchema: {
        project: projectArg,
        to: z.enum(['frame_picture', 'frame_reference', 'bible_entry', 'style', 'moodboard']),
        frame: frameRef.optional().describe('For to = frame_picture or frame_reference.'),
        entry: z.string().optional().describe('Bible entry name, for to = bible_entry.'),
        path: z.string().optional().describe('Full path of a file on this computer.'),
        url: z.string().optional().describe('A public web address of the file.'),
        hash: z.string().optional().describe('Set by the Weft connector after it uploads `path`; leave it out.'),
        name: z.string().optional(),
      },
    },
    guarded(async ({ project, to, frame, entry, path: filePath, url, hash, name }) => {
      const { session, s } = await open(project)
      const frameId = to === 'frame_picture' || to === 'frame_reference' ? (frame ? resolveFrame(s, frame) : null) : null
      if ((to === 'frame_picture' || to === 'frame_reference') && !frameId) throw new AgentError('Say which frame')
      const bible = to === 'bible_entry' ? (entry ? resolveEntry(s, entry) : null) : null
      if (to === 'bible_entry' && !bible) throw new AgentError(`No bible entry "${entry ?? ''}"`)

      let fileHash: string
      let mime: string
      let size: number
      let fileName = name ?? ''
      if (hash) {
        const row = getMedia(hash)
        if (!row) throw new AgentError("The file didn't reach the server. Try again.")
        ;({ hash: fileHash, mime, size } = row)
      } else if (url) {
        const file = await downloadPublic(url, config.maxUploadBytes)
        if (!MEDIA_TYPES.test(file.contentType)) throw new AgentError(`That address isn't an image, video or audio file (it's ${file.contentType || 'unknown'})`)
        const row = await storeMediaBuffer(new Uint8Array(file.data), file.contentType, me().id)
        ;({ hash: fileHash, mime, size } = row)
        fileName ||= decodeURIComponent(file.url.pathname.split('/').pop() || '') || file.url.hostname
      } else if (filePath) {
        throw new AgentError(
          "This server can't read files from your computer. Connect Claude to Weft through the Weft connector (it uploads the file), or give a web address instead.",
        )
      } else {
        throw new AgentError('Give a path or a url')
      }

      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'audio'
      const stored = mediaFile(fileHash)
      const dims = kind === 'image' && stored ? await imageSize(stored) : null
      const label = frameId ? labelsOf(s, [frameId]) : ''
      session.edit(
        () => {
          const assetId = session.project.addAsset({
            kind,
            hash: fileHash,
            name: fileName || `From Claude`,
            mime,
            size,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            createdBy: me().id,
          })
          if (to === 'frame_picture') session.project.addMediaVersion(frameId!, assetId, { label: 'From Claude' })
          else if (to === 'frame_reference') session.project.addReference(frameId!, assetId)
          else if (to === 'bible_entry') session.project.addBibleAsset(bible!.id, assetId)
          else if (to === 'style') session.project.addStyleRef(assetId)
          else {
            const items = Object.values(s.moodboard)
            const x = items.length ? Math.max(...items.map((i) => i.x + i.w)) + 40 : 0
            const y = items.length ? Math.min(...items.map((i) => i.y)) : 0
            const w = 280
            const h = dims ? Math.round(Math.min(520, Math.max(90, (w * dims.height) / dims.width))) : 210
            session.project.addMoodItem({ kind: 'asset', assetId, x, y, w, h })
          }
          return assetId
        },
        () => ({
          line:
            to === 'frame_picture'
              ? `Added a picture to frame ${label}`
              : to === 'frame_reference'
                ? `Added a reference to frame ${label}`
                : to === 'bible_entry'
                  ? `Added a picture to ${bible!.name}`
                  : to === 'style'
                    ? 'Added a style reference'
                    : 'Added a picture to the moodboard',
          frames: frameId ? [frameId] : [],
        }),
      )
      return text(`Attached ${fileName || 'the file'} (${kind}).`)
    }),
  )

  server.registerTool(
    'add_note',
    {
      title: 'Write in notes',
      description: 'Adds Markdown (headings, lists, bold, links) to the end of a notes page. A new page title creates the page.',
      inputSchema: { project: projectArg, markdown: z.string().min(1), page: z.string().optional().describe('Page title or id. Default: the first page.') },
    },
    guarded(async ({ project, markdown, page }) => {
      const { session, s } = await open(project)
      const existing = resolvePage(s, page)
      const { result } = session.edit(
        () => {
          const id = existing ?? session.project.createPage(page ?? 'Notes')
          session.project.appendToPage(id, markdown)
          return id
        },
        (id) => ({ line: `Wrote in notes page "${session.project.snapshot().pages[id]?.title || 'Untitled'}"` }),
      )
      return text(`Added to "${session.snapshot().pages[result]?.title || 'Untitled'}".`)
    }),
  )

  server.registerTool(
    'add_to_moodboard',
    {
      title: 'Add to the moodboard',
      description: 'Adds notes, colour swatches (hex like #D9A066) and links (with their page previews) to the moodboard, in a row after what is there.',
      inputSchema: {
        project: projectArg,
        notes: z.array(z.string().min(1)).max(20).optional(),
        colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(20).optional(),
        links: z.array(z.string().url()).max(10).optional(),
      },
    },
    guarded(async ({ project, notes = [], colors = [], links = [] }) => {
      const { session, s } = await open(project)
      const previews = await Promise.all(links.map((l) => unfurl(l).catch(() => null)))
      const items = Object.values(s.moodboard)
      let x = items.length ? Math.max(...items.map((i) => i.x + i.w)) + 40 : 0
      const y = items.length ? Math.min(...items.map((i) => i.y)) : 0
      const count = notes.length + colors.length + links.length
      if (!count) throw new AgentError('Give some notes, colours or links')
      session.edit(
        () => {
          for (const note of notes) {
            session.project.addMoodItem({ kind: 'note', text: note, x, y, w: 220, h: 180, color: '#f2c14e' })
            x += 244
          }
          for (const color of colors) {
            session.project.addMoodItem({ kind: 'color', color: color.toLowerCase(), x, y, w: 132, h: 150 })
            x += 156
          }
          links.forEach((link, i) => {
            const preview = previews[i]
            const assetId = session.project.addAsset({
              kind: 'link',
              url: preview?.url ?? link,
              name: link,
              title: preview?.title || link,
              preview: preview?.image ?? null,
              site: preview?.site ?? '',
              createdBy: me().id,
            })
            session.project.addMoodItem({ kind: 'asset', assetId, x, y, w: 280, h: preview?.image ? 236 : 112 })
            x += 304
          })
        },
        () => ({ line: `Added ${plural(count, 'item')} to the moodboard` }),
      )
      return text(`Added ${plural(count, 'item')} to the moodboard.`)
    }),
  )

  server.registerTool(
    'undo_changes',
    {
      title: 'Undo your changes',
      description: 'Undoes a change set you made (your latest by default), even if people have edited since; their edits stay.',
      inputSchema: { project: projectArg, change: z.string().optional().describe('Change set id. Default: your latest open one.') },
    },
    guarded(async ({ project, change }) => {
      const { session, s } = await open(project)
      const mine = session.ownChangeSets().filter((id) => s.changes[id]?.status === 'open')
      const target = change ?? mine.at(-1)
      if (!target || !session.owns(target)) throw new AgentError("There's nothing of yours to undo in this session.")
      const steps = session.undoChangeSet(target)
      return text(`Undid ${plural(steps, 'edit')}. ${cutLength(session.snapshot(), s.meta.mainCutId)}`)
    }),
  )

  // --------------------------------------------------------------- prompts

  server.registerPrompt(
    'board_script',
    {
      title: 'Board this script',
      description: 'Turns a script or idea into frames, timed to the target length.',
      argsSchema: {
        project: z.string().describe('Project title or id'),
        script: z.string().describe('The script, treatment or idea'),
        seconds: z.string().optional().describe('Target length in seconds, e.g. 30'),
      },
    },
    ({ project, script, seconds }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Board this as ${seconds ? `a ${seconds}-second` : 'a'} piece in the Weft project "${project}".

1. Read the project first (get_project, then get_cut) so you build on the brief, bible and any frames already there.
2. Add characters, locations and products it needs with upsert_bible_entry.
3. Add the frames with create_frames: for each shot, what we see, the VO or dialogue, any on-screen text, shot size and camera movement, and who and what is in it (in_shot).${seconds ? ` Keep the cut to about ${seconds} seconds: the VO times each shot at the project's pace, so check the total and trim words or set lengths.` : ''}
4. Give alternatives for key moments with add_variation rather than packing options into one frame.
5. Finish with the cut's length and anything you'd want me to decide.

Script:
${script}`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'image_prompts',
    {
      title: 'Write image prompts',
      description: "Writes an image-generation prompt for each frame into its notes, from the description, camera, bible and style.",
      argsSchema: { project: z.string().describe('Project title or id'), cut: z.string().optional().describe('Cut name (default: main)') },
    },
    ({ project, cut }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `In the Weft project "${project}", write an image-generation prompt for each frame of ${cut ? `the cut "${cut}"` : 'the main cut'}.

Read get_project (brief, tone, bible) and get_cut, and look at the style references and bible pictures with view_pictures. Each prompt should describe the shot (subject, action, framing from the shot size and angle, lens), consistent looks for recurring characters and places from the bible, lighting, and the project's style and aspect ratio. Write each into the frame's notes with update_frames, starting with "Image prompt:", keeping any notes already there.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'fit_cut',
    {
      title: 'Fit a cut to a length',
      description: 'Makes a cutdown of a cut at a new length, like 15s from 30s, without changing the original.',
      argsSchema: {
        project: z.string().describe('Project title or id'),
        seconds: z.string().describe('The new length in seconds, e.g. 15'),
        cut: z.string().optional().describe('The cut to start from (default: main)'),
      },
    },
    ({ project, seconds, cut }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `In the Weft project "${project}", make a ${seconds}-second version of ${cut ? `"${cut}"` : 'the main cut'}.

Read it with get_cut. Make a new cut with create_cut (target ${seconds} seconds), then hide shots with set_cut and shorten lengths for this cut only with set_timing. Where the VO is too long, add a variation with tighter VO (add_variation) and use it in the new cut, so the original keeps its words. Keep the story and the end card intact. Tell me the final length and what you cut.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'review_board',
    {
      title: 'Review the storyboard',
      description: 'Looks over the story, pacing, continuity and timing, without changing anything.',
      argsSchema: { project: z.string().describe('Project title or id'), cut: z.string().optional().describe('Cut name (default: main)') },
    },
    ({ project, cut }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review ${cut ? `the cut "${cut}"` : 'the main cut'} of the Weft project "${project}" without changing anything: read get_project, get_cut and view_frames. Tell me what works, then the problems in order of importance: story and clarity against the brief, pacing and shot lengths against the target, continuity (characters, wardrobe, screen direction), VO that doesn't fit its shot, and missing coverage. Suggest fixes I can ask you to make.`,
          },
        },
      ],
    }),
  )

  return server
}
