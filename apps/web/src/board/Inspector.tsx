import {
  CAMERA_ANGLES,
  CAMERA_MOVES,
  SHOT_SIZES,
  TRANSITIONS,
  aspectValue,
  baseDuration,
  countWords,
  cutTimeline,
  describeSketch,
  formatDuration,
  formatSeconds,
  graphOf,
  shotLabels,
  spokenSeconds,
  voWordCount,
  type AudioKind,
  type BibleEntrySnapshot,
  type CameraAngle,
  type CameraMove,
  type FrameSnapshot,
  type FrameStatus,
  type ShotSize,
  type TransitionType,
} from '@weft/model'
import { ArrowRight, BookOpen, Clapperboard, GitBranchPlus, ImagePlus, PenLine, Plus, Trash2, Unlink, X } from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { attachToFrame } from '../lib/attach'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { droppedAssetIds, isMediaDrag } from '../lib/dnd'
import { importFiles, mediaFiles } from '../lib/media'
import { navigate, writePath } from '../lib/router'
import { BoundTextarea } from '../project/BoundText'
import { openVideoPrompt } from '../prompts/VideoPrompts'
import { PAPER, SketchLayer, openSketch } from '../sketch/SketchLayer'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, Field, IconButton, Kbd, Menu, Segmented, Select, textareaClass } from '../ui'
import { CommitInput, SecondsInput, Thumb, useFilePicker } from '../ui/inputs'
import { EntryAvatar, BibleIcon, bibleOrder, entryName } from '../write/bible-kinds'
import { EmptyMedia, MediaFill } from './Media'

export function Inspector({
  cutId,
  frameIds,
  linkId,
  onFrameCreated,
}: {
  cutId: string
  frameIds: string[]
  linkId: string | null
  onFrameCreated: (frameId: string, opts?: { focus?: boolean }) => void
}) {
  const s = useSnapshot()
  if (linkId && s.links[linkId]) return <LinkInspector key={linkId} linkId={linkId} cutId={cutId} />
  const only = frameIds.length === 1 ? frameIds[0] : undefined
  if (only && s.frames[only]) {
    return <FrameInspector key={only} frameId={only} cutId={cutId} onFrameCreated={onFrameCreated} />
  }
  if (frameIds.length > 1) return <MultiInspector frameIds={frameIds} />
  return <CutOverview cutId={cutId} />
}

// ------------------------------------------------------------------ parts

function Header({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-line bg-panel px-4">
      {children}
      {actions && <div className="ml-auto flex items-center gap-0.5">{actions}</div>}
    </header>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// ------------------------------------------------------------------ frame

const STATUS_OPTIONS: ReadonlyArray<{ id: FrameStatus; label: string }> = [
  { id: 'idea', label: 'Idea' },
  { id: 'draft', label: 'Draft' },
  { id: 'approved', label: 'Approved' },
]

function FrameInspector({
  frameId,
  cutId,
  onFrameCreated,
}: {
  frameId: string
  cutId: string
  onFrameCreated: (frameId: string, opts?: { focus?: boolean }) => void
}) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const frame = s.frames[frameId]!
  const label = shotLabels(s).get(frameId)

  const addMedia = async (files: File[]) => {
    const ids = await importFiles(project, files, user.id)
    if (ids.length) project.transact(() => ids.forEach((id) => project.addMediaVersion(frameId, id)))
  }
  const addRefs = async (files: File[]) => {
    const ids = await importFiles(project, files, user.id)
    if (ids.length) project.transact(() => ids.forEach((id) => project.addReference(frameId, id)))
  }
  const mediaPicker = useFilePicker((files) => void addMedia(files))
  const refPicker = useFilePicker((files) => void addRefs(files), 'image/*,video/*,audio/*')
  const dropZone = (target: 'media' | 'references') => ({
    onDragOver: (e: DragEvent) => {
      if (!isMediaDrag(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: DragEvent) => {
      const files = mediaFiles(e.dataTransfer)
      const assetIds = droppedAssetIds(e.dataTransfer)
      if (!files.length && !assetIds.length) return
      e.preventDefault()
      if (files.length) void (target === 'media' ? addMedia(files) : addRefs(files))
      else attachToFrame(project, frameId, assetIds, target)
    },
  })

  const hero = frame.media.find((m) => m.id === frame.heroMediaId)
  const heroAsset = hero ? s.assets[hero.assetId] : undefined

  return (
    <div>
      <Header
        actions={
          <>
            <IconButton size="sm" label="Video prompt" tooltip="Video prompt: for Google Flow, Higgsfield and others" onClick={() => openVideoPrompt(frameId)}>
              <Clapperboard size={15} />
            </IconButton>
            <IconButton
              size="sm"
              label="Add a variation"
              onClick={() => onFrameCreated(project.addVariation(frameId), { focus: true })}
            >
              <GitBranchPlus size={15} />
            </IconButton>
            <IconButton
              size="sm"
              label="Detach from sequence"
              tooltip="Detach: cut this frame's links (the frames around it stay connected)"
              disabled={!Object.values(s.links).some((l) => l.from === frameId || l.to === frameId)}
              onClick={() => project.detachFrame(frameId)}
            >
              <Unlink size={15} />
            </IconButton>
            <IconButton size="sm" label="Delete frame" onClick={() => project.deleteFrames([frameId])}>
              <Trash2 size={15} />
            </IconButton>
          </>
        }
      >
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-strong tabular-nums">
          {label ?? 'Unlinked'}
        </span>
        <span className="font-medium text-fg">Frame</span>
      </Header>

      <div className="flex flex-col gap-6 p-4">
        <Section
          title="Frame image"
          action={
            <div className="flex gap-0.5">
              <Button size="sm" variant="ghost" icon={<PenLine size={14} />} onClick={() => openSketch(frameId)} title="Sketch on this frame (D)">
                Sketch
              </Button>
              <Button size="sm" variant="ghost" icon={<ImagePlus size={14} />} onClick={mediaPicker.open}>
                {frame.media.length ? 'New version' : 'Add'}
              </Button>
            </div>
          }
        >
          <div
            className="relative overflow-hidden rounded-lg border border-line bg-media"
            style={{ aspectRatio: s.meta.aspect.replace(':', ' / ') }}
            {...dropZone('media')}
          >
            {heroAsset ? (
              <MediaFill media={{ hash: heroAsset.hash, kind: heroAsset.kind, title: heroAsset.name }} controls={!frame.sketch.length} size={1280} />
            ) : frame.sketch.length ? (
              <button type="button" onClick={() => openSketch(frameId)} className="size-full" style={{ background: PAPER }} aria-label="Sketch on this frame" />
            ) : (
              <button type="button" onClick={mediaPicker.open} className="size-full" aria-label="Add an image or video">
                <EmptyMedia />
              </button>
            )}
            <SketchLayer strokes={frame.sketch} aspect={aspectValue(s.meta.aspect)} />
          </div>
          {frame.sketch.length > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-fg-3">
              Sketch: {describeSketch(frame.sketch)}.
              <button type="button" onClick={() => project.clearSketch(frameId)} className="font-medium text-fg-2 hover:text-fg hover:underline">
                Clear
              </button>
            </p>
          )}
          {frame.media.length > 1 && (
            <div className="grid grid-cols-5 gap-1.5">
              {[...frame.media].reverse().map((version, i) => {
                const asset = s.assets[version.assetId]
                const n = frame.media.length - i
                return (
                  <Thumb
                    key={version.id}
                    media={{ hash: asset?.hash ?? null, kind: asset?.kind ?? 'image' }}
                    active={version.id === frame.heroMediaId}
                    label={`Version ${n}`}
                    onClick={() => project.setHeroMedia(frameId, version.id)}
                    onRemove={() => project.removeMediaVersion(frameId, version.id)}
                  />
                )
              })}
            </div>
          )}
          {frame.media.length > 1 && <p className="text-[11px] text-fg-3">Click a version to show it in the frame.</p>}
        </Section>

        <Field label="Description">
          <BoundTextarea
            bindKey={`${frameId}:description`}
            resolve={() => project.frameText(frameId, 'description')}
            autoGrow
            rows={2}
            placeholder="What happens in this shot?"
            className={textareaClass}
          />
        </Field>

        <AudioSection frame={frame} />

        <Field label="On-screen text" hint="Supers, taglines, CTA">
          <BoundTextarea
            bindKey={`${frameId}:onScreenText`}
            resolve={() => project.frameText(frameId, 'onScreenText')}
            autoGrow
            rows={1}
            placeholder="Text that appears on screen"
            className={textareaClass}
          />
        </Field>

        <TagsSection frame={frame} />

        <Section title="Camera">
          <Segmented<ShotSize>
            label="Shot size"
            size="sm"
            allowClear
            options={SHOT_SIZES.map((o) => ({ id: o.id, label: o.short, title: o.label }))}
            value={frame.shotSize}
            onChange={(v) => project.updateFrame(frameId, { shotSize: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              aria-label="Camera angle"
              value={frame.angle ?? ''}
              onChange={(e) => project.updateFrame(frameId, { angle: (e.target.value || null) as CameraAngle | null })}
            >
              <option value="">Angle</option>
              {CAMERA_ANGLES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Camera movement"
              value={frame.movement ?? ''}
              onChange={(e) => project.updateFrame(frameId, { movement: (e.target.value || null) as CameraMove | null })}
            >
              <option value="">Movement</option>
              {CAMERA_MOVES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <CommitInput
            aria-label="Lens"
            value={frame.lens ?? ''}
            placeholder="Lens (e.g. 35mm)"
            onCommit={(v) => project.updateFrame(frameId, { lens: v.trim() || null })}
          />
        </Section>

        <TimingSection frame={frame} cutId={cutId} />

        <Field label="Status">
          <Segmented<FrameStatus>
            label="Status"
            size="sm"
            options={STATUS_OPTIONS}
            value={frame.status}
            onChange={(v) => v && project.updateFrame(frameId, { status: v })}
          />
        </Field>

        <Section
          title="References"
          action={
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={refPicker.open}>
              Add
            </Button>
          }
        >
          <div className="rounded-lg border border-dashed border-line p-2" {...dropZone('references')}>
            {frame.references.length ? (
              <div className="grid grid-cols-4 gap-1.5">
                {frame.references.map((id) => {
                  const asset = s.assets[id]
                  if (!asset) return null
                  return (
                    <Thumb
                      key={id}
                      media={{ hash: asset.hash, kind: asset.kind, title: asset.name }}
                      label={asset.title || asset.name || 'Reference'}
                      onRemove={() => project.removeReference(frameId, id)}
                    />
                  )
                })}
              </div>
            ) : (
              <p className="py-2 text-center text-[12px] text-fg-3">
                Mood and inspiration images. They don't play in the animatic.
              </p>
            )}
          </div>
        </Section>

        <Field label="Motion notes" hint="For motion graphics">
          <BoundTextarea
            bindKey={`${frameId}:motionNotes`}
            resolve={() => project.frameText(frameId, 'motionNotes')}
            autoGrow
            rows={1}
            placeholder="How things move or animate"
            className={textareaClass}
          />
        </Field>

        <Field label="Notes">
          <BoundTextarea
            bindKey={`${frameId}:notes`}
            resolve={() => project.frameText(frameId, 'notes')}
            autoGrow
            rows={2}
            placeholder="Anything else about this frame"
            className={textareaClass}
          />
        </Field>

        <SceneField frame={frame} />
      </div>
      {mediaPicker.input}
      {refPicker.input}
    </div>
  )
}

/** Bible entries (cast, locations, products) tagged in this frame. */
function TagsSection({ frame }: { frame: FrameSnapshot }) {
  const s = useSnapshot()
  const project = useProject()
  const { projectId } = useProjectContext()
  const entries = Object.values(s.bible).sort(bibleOrder)
  const tagged = frame.tags.map((id) => s.bible[id]).filter((e): e is BibleEntrySnapshot => e !== undefined)
  const untagged = entries.filter((e) => !frame.tags.includes(e.id))
  const openBible = () => navigate(writePath(projectId, { section: 'bible', pageId: null }))
  return (
    <Section
      title="In this shot"
      action={
        entries.length > 0 && (
          <Menu
            trigger={
              <Button size="sm" variant="ghost" icon={<Plus size={14} />}>
                Tag
              </Button>
            }
            items={[
              ...untagged.map((e) => ({
                label: entryName(e),
                icon: <BibleIcon kind={e.kind} size={14} />,
                onSelect: () => project.toggleFrameTag(frame.id, e.id),
              })),
              ...(untagged.length ? (['separator'] as const) : []),
              { label: 'Open the bible', icon: <BookOpen size={14} />, onSelect: openBible },
            ]}
          />
        )
      }
    >
      {tagged.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tagged.map((entry) => (
            <span key={entry.id} className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-bg pr-1 pl-1">
              <EntryAvatar entry={entry} s={s} />
              <span className="max-w-[140px] truncate text-[12px] text-fg">{entryName(entry)}</span>
              <button
                type="button"
                onClick={() => project.toggleFrameTag(frame.id, entry.id)}
                aria-label={`Untag ${entryName(entry)}`}
                className="flex size-5 items-center justify-center rounded-full text-fg-3 hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : entries.length > 0 ? (
        <p className="text-[12px] text-fg-3">Tag the characters, locations and products this shot needs.</p>
      ) : (
        <p className="text-[12px] text-fg-3">
          Add your cast, locations and products in the{' '}
          <button type="button" onClick={openBible} className="text-accent-strong hover:underline">
            bible
          </button>
          , then tag them here.
        </p>
      )}
    </Section>
  )
}

function AudioSection({ frame }: { frame: FrameSnapshot }) {
  const project = useProject()
  const s = useSnapshot()
  const words = voWordCount(frame)
  const spoken = spokenSeconds(frame, s.meta.wordsPerSecond, s.assets)
  return (
    <Section
      title="Voiceover and dialogue"
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          onClick={() => project.addAudioLine(frame.id, { kind: frame.audio.length ? 'dialogue' : 'vo' })}
        >
          Line
        </Button>
      }
    >
      {frame.audio.length === 0 ? (
        <BoundTextarea
          bindKey={`${frame.id}:vo:none`}
          resolve={() => null}
          create={(initial) => {
            project.setVo(frame.id, initial)
            return project.audioText(frame.id, project.voLineId(frame.id))
          }}
          autoGrow
          rows={2}
          placeholder="Voiceover for this frame"
          className={textareaClass}
        />
      ) : (
        frame.audio.map((line) => (
          <div key={line.id} className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
            <div className="flex items-center gap-1.5">
              <Select
                aria-label="Line type"
                value={line.kind}
                onChange={(e) => project.updateAudioLine(frame.id, line.id, { kind: e.target.value as AudioKind })}
                className="h-7 w-[118px] text-[12px]"
              >
                <option value="vo">Voiceover</option>
                <option value="dialogue">Dialogue</option>
              </Select>
              <CommitInput
                aria-label={line.kind === 'vo' ? 'Voice' : 'Character'}
                value={line.speaker}
                placeholder={line.kind === 'vo' ? 'Voice (optional)' : 'Character'}
                onCommit={(v) => project.updateAudioLine(frame.id, line.id, { speaker: v })}
                className="h-7 flex-1 text-[12px]"
              />
              <IconButton size="sm" label="Remove line" onClick={() => project.removeAudioLine(frame.id, line.id)}>
                <X size={14} />
              </IconButton>
            </div>
            <BoundTextarea
              bindKey={`${frame.id}:audio:${line.id}`}
              resolve={() => project.audioText(frame.id, line.id)}
              autoGrow
              rows={2}
              placeholder={line.kind === 'vo' ? 'What the voiceover says' : 'What they say'}
              className={cx(textareaClass, 'border-transparent bg-transparent px-1 hover:border-transparent')}
            />
          </div>
        ))
      )}
      {words > 0 && (
        <p className="text-[11px] text-fg-3">
          {words} {words === 1 ? 'word' : 'words'} · about {formatDuration(spoken)} spoken at {s.meta.wordsPerSecond} words/s
        </p>
      )}
    </Section>
  )
}

function TimingSection({ frame, cutId }: { frame: FrameSnapshot; cutId: string }) {
  const project = useProject()
  const s = useSnapshot()
  const cut = s.cuts[cutId]
  const item = cutTimeline(s, cutId).byFrame.get(frame.id)
  const base = baseDuration(frame, s.meta, s.assets)
  const words = voWordCount(frame)
  const recorded = frame.audio.some((line) => line.assetId && s.assets[line.assetId]?.duration)
  return (
    <Section title="Timing">
      <div className="flex items-center gap-2">
        <Segmented<'auto' | 'manual'>
          label="Duration mode"
          size="sm"
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'manual', label: 'Manual' },
          ]}
          value={frame.durationMode}
          onChange={(v) => (v === 'auto' ? project.resetDuration(frame.id) : project.setDuration(frame.id, base))}
        />
        {frame.durationMode === 'manual' && (
          <div className="flex items-center gap-1.5">
            <SecondsInput
              label="Duration in seconds"
              value={frame.duration}
              onCommit={(v) => v !== null && project.setDuration(frame.id, v)}
              className="h-7 w-16 text-[12px]"
            />
            <span className="text-fg-3">sec</span>
          </div>
        )}
      </div>
      {frame.durationMode === 'auto' && (
        <p className="text-[12px] text-fg-2">
          {recorded
            ? `${formatDuration(base)}, from the recorded voiceover.`
            : words > 0
              ? `${formatDuration(base)}, from the voiceover.`
              : `${formatDuration(base)}. With no voiceover, this uses the frame's default length.`}
        </p>
      )}
      {cut && (
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="text-[12px] font-medium text-fg">In “{cut.name}”</div>
          {item ? (
            <>
              <div className="flex items-center justify-between gap-2 text-[12px] text-fg-2">
                <span>Starts at {formatSeconds(item.start)}</span>
                <div className="flex items-center gap-1.5">
                  <span>Length</span>
                  <SecondsInput
                    label="Length in this cut"
                    value={cut.overrides[frame.id] ?? null}
                    placeholder={String(Math.round(base * 10) / 10)}
                    allowEmpty
                    onCommit={(v) => project.setOverride(cutId, frame.id, v)}
                    className="h-7 w-16 text-[12px]"
                  />
                  <span className="text-fg-3">sec</span>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg-2">
                <input
                  type="checkbox"
                  checked={item.hidden}
                  onChange={(e) => project.setHidden(cutId, frame.id, e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Hide in this cut
              </label>
            </>
          ) : (
            <>
              <p className="text-[12px] text-fg-2">This frame isn't part of this cut.</p>
              <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => project.routeThrough(cutId, frame.id)}>
                Use in this cut
              </Button>
            </>
          )}
        </div>
      )}
    </Section>
  )
}

function SceneField({ frame }: { frame: FrameSnapshot }) {
  const project = useProject()
  const s = useSnapshot()
  const scenes = Object.values(s.scenes).sort((a, b) => a.createdAt - b.createdAt)
  return (
    <Field label="Scene">
      <Select
        aria-label="Scene"
        value={frame.sceneId ?? ''}
        onChange={(e) => {
          const value = e.target.value
          if (value === '__new') {
            const id = project.createScene({ title: `Scene ${scenes.length + 1}` })
            project.assignScene([frame.id], id)
          } else {
            project.assignScene([frame.id], value || null)
          }
        }}
      >
        <option value="">No scene</option>
        {scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.title || 'Untitled scene'}
          </option>
        ))}
        <option value="__new">New scene…</option>
      </Select>
    </Field>
  )
}

// ------------------------------------------------------------------- link

function LinkInspector({ linkId, cutId }: { linkId: string; cutId: string }) {
  const s = useSnapshot()
  const project = useProject()
  const link = s.links[linkId]!
  const labels = shotLabels(s)
  const cut = s.cuts[cutId]
  const inCut = cutTimeline(s, cutId).items.some((i) => i.linkInId === linkId)
  const isFork = graphOf(s).out(link.from).length > 1
  return (
    <div>
      <Header
        actions={
          <IconButton size="sm" label="Delete link" onClick={() => project.deleteLink(linkId)}>
            <Trash2 size={15} />
          </IconButton>
        }
      >
        <span className="font-medium text-fg">Link</span>
        <span className="text-fg-2 tabular-nums">
          {labels.get(link.from) ?? '—'} → {labels.get(link.to) ?? '—'}
        </span>
      </Header>
      <div className="flex flex-col gap-5 p-4">
        <Field label="Transition">
          <Select
            aria-label="Transition"
            value={link.transition}
            onChange={(e) => {
              const transition = e.target.value as TransitionType
              project.updateLink(linkId, {
                transition,
                transitionDuration: transition === 'cut' ? 0 : link.transitionDuration || 0.5,
              })
            }}
          >
            {TRANSITIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {link.transition !== 'cut' && (
          <Field label="Transition length">
            <div className="flex items-center gap-1.5">
              <SecondsInput
                label="Transition length in seconds"
                value={link.transitionDuration || 0.5}
                onCommit={(v) => v !== null && project.updateLink(linkId, { transitionDuration: v })}
                className="w-20"
              />
              <span className="text-fg-3">sec</span>
            </div>
          </Field>
        )}
        <Field label="Note">
          <CommitInput
            aria-label="Link note"
            value={link.note}
            placeholder="e.g. Match on the door handle"
            onCommit={(v) => project.updateLink(linkId, { note: v.trim() })}
          />
        </Field>
        {isFork && cut && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            {inCut ? (
              <p className="text-[12px] text-fg-2">“{cut.name}” follows this path.</p>
            ) : (
              <>
                <p className="text-[12px] text-fg-2">“{cut.name}” takes a different path at this fork.</p>
                <Button
                  size="sm"
                  icon={<ArrowRight size={14} />}
                  onClick={() =>
                    project.transact(() => {
                      project.routeThrough(cutId, link.from)
                      project.chooseLink(cutId, linkId)
                    })
                  }
                >
                  Use this path
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ multi / cut

function MultiInspector({ frameIds }: { frameIds: string[] }) {
  const project = useProject()
  const s = useSnapshot()
  const scenes = Object.values(s.scenes).sort((a, b) => a.createdAt - b.createdAt)
  return (
    <div>
      <Header>
        <span className="font-medium text-fg">{frameIds.length} frames selected</span>
      </Header>
      <div className="flex flex-col gap-4 p-4">
        <Field label="Scene">
          <Select
            aria-label="Scene for selected frames"
            value=""
            onChange={(e) => {
              const value = e.target.value
              if (value === '__none') project.assignScene(frameIds, null)
              else if (value === '__new') project.assignScene(frameIds, project.createScene({ title: `Scene ${scenes.length + 1}` }))
              else if (value) project.assignScene(frameIds, value)
            }}
          >
            <option value="">Move to scene…</option>
            <option value="__none">No scene</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.title || 'Untitled scene'}
              </option>
            ))}
            <option value="__new">New scene…</option>
          </Select>
        </Field>
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => project.deleteFrames(frameIds)}>
          Delete {frameIds.length} frames
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className={cx('mt-0.5 text-[20px] font-semibold tabular-nums', warn ? 'text-warn' : 'text-fg')}>{value}</div>
      <div className={cx('text-[11px]', warn ? 'text-warn' : 'text-fg-3')}>{sub}</div>
    </div>
  )
}

function CutOverview({ cutId }: { cutId: string }) {
  const s = useSnapshot()
  const project = useProject()
  const cut = s.cuts[cutId]
  const t = cutTimeline(s, cutId)
  if (!cut) return null
  const visible = t.items.filter((i) => !i.hidden)
  const noImage = visible.filter((i) => !s.frames[i.frameId]?.heroMediaId).length
  const target = cut.targetDuration
  const over = target !== null && t.total > target + 0.05
  const words = visible.reduce((n, i) => n + (s.frames[i.frameId]?.audio.reduce((m, l) => m + countWords(l.text), 0) ?? 0), 0)
  return (
    <div>
      <Header>
        <span className="font-medium text-fg">{cut.name}</span>
        {cut.isMain && <span className="rounded bg-hover px-1.5 py-0.5 text-[11px] text-fg-2">Main cut</span>}
      </Header>
      <div className="flex flex-col gap-5 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Length"
            value={formatSeconds(t.total)}
            sub={target === null ? 'No target set' : over ? `${formatDuration(t.total - target)} over target` : `Target ${formatSeconds(target)}`}
            warn={over}
          />
          <Stat label="Frames" value={String(visible.length)} sub={noImage ? `${noImage} without an image` : 'All have images'} />
        </div>
        <Field label="Target length" hint={words ? `${words} words of VO` : undefined}>
          <div className="flex items-center gap-1.5">
            <SecondsInput
              label="Target length in seconds"
              value={target}
              allowEmpty
              placeholder="None"
              onCommit={(v) => project.setCutTarget(cutId, v)}
              className="w-24"
            />
            <span className="text-fg-3">sec</span>
          </div>
        </Field>
        <div className="rounded-lg border border-line p-3">
          <h3 className="mb-2 text-[12px] font-medium text-fg">Quick keys</h3>
          <ul className="flex flex-col gap-1.5 text-[12px] text-fg-2">
            <li className="flex justify-between gap-2"><span>Next frame</span><span><Kbd>Enter</Kbd> or <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> while typing</span></li>
            <li className="flex justify-between gap-2"><span>Variation</span><Kbd>Shift Enter</Kbd></li>
            <li className="flex justify-between gap-2"><span>Delete</span><Kbd>Del</Kbd></li>
            <li className="flex justify-between gap-2"><span>Undo / redo</span><span><Kbd>Ctrl Z</Kbd> <Kbd>Ctrl Shift Z</Kbd></span></li>
            <li className="flex justify-between gap-2"><span>Cut links</span><span><Kbd>K</Kbd> or <Kbd>Ctrl</Kbd> + right-drag</span></li>
            <li className="flex justify-between gap-2"><span>Pull a frame out</span><span><Kbd>Alt</Kbd> + drag</span></li>
            <li className="flex justify-between gap-2"><span>Select several</span><span><Kbd>Shift</Kbd> + drag</span></li>
          </ul>
          <p className="mt-3 text-[12px] text-fg-3">
            To reorder, drag a frame onto a link or beside another frame. Right-click a frame for more. Drag from a
            frame's right dot to branch. Drop or paste images onto frames.
          </p>
        </div>
      </div>
    </div>
  )
}
