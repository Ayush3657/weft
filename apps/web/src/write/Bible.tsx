import {
  ASPECT_RATIOS,
  BIBLE_KINDS,
  PROJECT_TYPES,
  cutTimeline,
  shotLabels,
  type AspectRatio,
  type BibleEntrySnapshot,
  type BibleKind,
  type ProjectType,
} from '@weft/model'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { revealOnBoard } from '../board/actions'
import { cx } from '../lib/cx'
import { claimFocus, focusSoon } from '../lib/focus'
import { navigate, projectPath } from '../lib/router'
import { BoundTextarea } from '../project/BoundText'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, Field, IconButton, Menu, Modal, Segmented, textareaClass } from '../ui'
import { CommitInput, SecondsInput } from '../ui/inputs'
import { AssetStrip } from './AssetStrip'
import { BIBLE_KIND_INFO, BibleIcon, EntryAvatar, entryName } from './bible-kinds'

const TYPE_LABELS: Record<ProjectType, string> = { ad: 'Ad', film: 'Film', other: 'Other' }

const PLACEHOLDERS: Record<BibleKind, string> = {
  character: 'Age, look, wardrobe, personality, how they speak…',
  location: 'Where it is, time of day, mood, what must be in frame…',
  product: 'Name and variant, packaging, logo rules, what must be shown…',
}

const nameSelector = (id: string) => `[data-bible-name="${id}"]`

/** The brief, style, and the cast, locations and products every frame draws on. */
export function Bible() {
  const s = useSnapshot()
  const entries = Object.values(s.bible)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[960px] flex-col gap-10 px-6 pt-6 pb-20">
        <Brief />
        {BIBLE_KINDS.map((kind) => (
          <KindSection key={kind} kind={kind} entries={entries.filter((e) => e.kind === kind).sort((a, b) => a.createdAt - b.createdAt)} />
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {hint && <p className="mt-0.5 text-fg-2">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

function Brief() {
  const s = useSnapshot()
  const project = useProject()
  return (
    <section>
      <SectionHeader title="Brief" hint="What the piece is, who it's for and how it should feel. Every frame should serve this." />
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-4">
        <Field label="Idea" hint="One or two sentences">
          <BoundTextarea
            bindKey="brief:logline"
            resolve={() => project.briefText('logline')}
            autoGrow
            rows={2}
            placeholder="A family discovers the home they'll grow into."
            className={cx(textareaClass, 'text-[14px]')}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Audience">
            <BoundTextarea
              bindKey="brief:audience"
              resolve={() => project.briefText('audience')}
              autoGrow
              rows={2}
              placeholder="First-time buyers, 28 to 40, in the city"
              className={textareaClass}
            />
          </Field>
          <Field label="Tone and style">
            <BoundTextarea
              bindKey="brief:tone"
              resolve={() => project.briefText('tone')}
              autoGrow
              rows={2}
              placeholder="Warm, unhurried, golden hour; handheld and close"
              className={textareaClass}
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-[auto_auto_1fr]">
          <Field label="Type">
            <Segmented<ProjectType>
              label="Project type"
              size="sm"
              options={PROJECT_TYPES.map((t) => ({ id: t, label: TYPE_LABELS[t] }))}
              value={s.meta.type}
              onChange={(v) => v && project.updateMeta({ type: v })}
            />
          </Field>
          <Field label="Aspect ratio">
            <Segmented<AspectRatio>
              label="Aspect ratio"
              size="sm"
              options={ASPECT_RATIOS.map((a) => ({ id: a, label: a }))}
              value={s.meta.aspect}
              onChange={(v) => v && project.updateMeta({ aspect: v })}
            />
          </Field>
          <Field label="VO pace" hint="Used to time frames from their voiceover">
            <div className="flex items-center gap-1.5">
              <SecondsInput
                label="Voiceover words per second"
                value={s.meta.wordsPerSecond}
                onCommit={(v) => v !== null && project.updateMeta({ wordsPerSecond: Math.min(6, Math.max(0.5, v)) })}
                className="h-7 w-16 text-[12px]"
              />
              <span className="text-[12px] text-fg-3">words per second</span>
            </div>
          </Field>
        </div>
        <Field label="Style references" hint="Looks, grades, framing you're after">
          <AssetStrip
            assetIds={s.brief.styleRefs}
            columns={8}
            onAdd={(ids) => project.transact(() => ids.forEach((id) => project.addStyleRef(id)))}
            onRemove={(id) => project.removeStyleRef(id)}
            empty="Drop in stills, grades and frames you love. They're kept in the Library too."
          />
        </Field>
      </div>
    </section>
  )
}

function KindSection({ kind, entries }: { kind: BibleKind; entries: BibleEntrySnapshot[] }) {
  const project = useProject()
  const info = BIBLE_KIND_INFO[kind]
  const add = () => focusSoon(nameSelector(project.createBibleEntry(kind)))
  return (
    <section>
      <SectionHeader
        title={info.plural}
        hint={info.hint}
        action={
          <Button size="sm" icon={<Plus size={14} />} onClick={add}>
            Add {info.label.toLowerCase()}
          </Button>
        }
      />
      {entries.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-5 text-left text-fg-2 hover:border-accent hover:text-fg"
        >
          <BibleIcon kind={kind} size={18} className="text-fg-3" />
          <span>Add a {info.label.toLowerCase()}. Tag them in frames on the board to track who and what each shot needs.</span>
        </button>
      )}
    </section>
  )
}

function EntryCard({ entry }: { entry: BibleEntrySnapshot }) {
  const s = useSnapshot()
  const project = useProject()
  const { projectId } = useProjectContext()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => claimFocus(nameSelector(entry.id)), [entry.id])

  const frames = useMemo(() => {
    const order = new Map(cutTimeline(s, s.meta.mainCutId).items.map((item, i) => [item.frameId, i]))
    return Object.values(s.frames)
      .filter((f) => f.tags.includes(entry.id))
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.createdAt - b.createdAt)
  }, [s, entry.id])
  const labels = shotLabels(s)
  const info = BIBLE_KIND_INFO[entry.kind]

  const remove = () => (frames.length ? setConfirming(true) : project.deleteBibleEntry(entry.id))

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-center gap-2.5">
        <EntryAvatar entry={entry} s={s} size={36} />
        <CommitInput
          data-bible-name={entry.id}
          aria-label={`${info.label} name`}
          value={entry.name}
          placeholder={`${info.label} name`}
          onCommit={(v) => project.updateBibleEntry(entry.id, { name: v.trim() })}
          className="h-8 flex-1 border-transparent bg-transparent px-1.5 text-[14px] font-semibold hover:border-line focus:bg-bg"
        />
        <Menu
          trigger={
            <IconButton size="sm" label={`${entryName(entry)} options`}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={[
            ...BIBLE_KINDS.filter((k) => k !== entry.kind).map((k) => ({
              label: `Make it a ${BIBLE_KIND_INFO[k].label.toLowerCase()}`,
              icon: <BibleIcon kind={k} size={14} />,
              onSelect: () => project.updateBibleEntry(entry.id, { kind: k }),
            })),
            'separator' as const,
            { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: remove },
          ]}
        />
      </div>
      <BoundTextarea
        bindKey={`bible:${entry.id}`}
        resolve={() => project.bibleText(entry.id)}
        autoGrow
        rows={2}
        placeholder={PLACEHOLDERS[entry.kind]}
        aria-label={`About ${entryName(entry)}`}
        className={textareaClass}
      />
      <AssetStrip
        assetIds={entry.assetIds}
        columns={6}
        onAdd={(ids) => project.transact(() => ids.forEach((id) => project.addBibleAsset(entry.id, id)))}
        onRemove={(id) => project.removeBibleAsset(entry.id, id)}
      />
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-fg-3">{frames.length ? 'In' : 'Not tagged in any frame yet'}</span>
        {frames.map((f) => (
          <button
            key={f.id}
            type="button"
            title={f.description || 'Show on the board'}
            onClick={() => {
              revealOnBoard(f.id)
              navigate(projectPath(projectId, 'board'))
            }}
            className="h-5 rounded bg-hover px-1.5 text-[11px] font-semibold text-fg-2 tabular-nums hover:bg-accent-soft hover:text-accent-strong"
          >
            {labels.get(f.id) ?? '—'}
          </button>
        ))}
      </div>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${entryName(entry)}?`}
        description={`${entry.kind === 'character' ? 'They’re' : 'It’s'} tagged in ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'}. The tags go too; pictures stay in the Library.`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => {
              setConfirming(false)
              project.deleteBibleEntry(entry.id)
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </article>
  )
}
