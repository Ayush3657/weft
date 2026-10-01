import {
  countWords,
  cutTimeline,
  formatDuration,
  formatSeconds,
  graphOf,
  isBlankFrame,
  shotLabels,
  type TimelineItem,
} from '@weft/model'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ClipboardPaste,
  Eye,
  EyeOff,
  GitBranchPlus,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { revealOnBoard } from '../board/actions'
import { MediaFill } from '../board/Media'
import { cx } from '../lib/cx'
import { claimFocus, focusSoon } from '../lib/focus'
import { usePref } from '../lib/prefs'
import { navigate, projectPath } from '../lib/router'
import { BoundTextarea } from '../project/BoundText'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, IconButton, Kbd, Menu, Tooltip } from '../ui'
import { SecondsInput } from '../ui/inputs'
import { PasteScript } from './PasteScript'

const ROW_MIME = 'application/x-weft-script-row'
const cellSelector = (frameId: string) => `[data-script-cell="${frameId}"]`

const cellClass =
  'block w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 leading-[1.5] text-fg placeholder:text-fg-3 hover:border-line focus:border-accent focus:bg-bg focus:outline-none'

/** The AV script: each row is a frame in the current cut, in cut order. */
export function Script({ cutId }: { cutId: string }) {
  const s = useSnapshot()
  const project = useProject()
  const { projectId } = useProjectContext()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [textPref, setTextPref] = usePref('script-supers')
  const showText = textPref !== '0'
  const [drag, setDrag] = useState<{ frameId: string; target: string | null; side: 'before' | 'after' } | null>(null)

  const cut = s.cuts[cutId]
  const timeline = cutTimeline(s, cutId)
  const labels = shotLabels(s)
  const visible = timeline.items.filter((i) => !i.hidden)
  const words = visible.reduce((n, i) => n + (s.frames[i.frameId]?.audio.reduce((m, l) => m + countWords(l.text), 0) ?? 0), 0)
  const offCut = Object.keys(s.frames).length - timeline.items.length
  const target = cut?.targetDuration ?? null
  const over = target !== null && timeline.total > target + 0.05
  const onlyItem = timeline.items.length === 1 ? timeline.items[0] : undefined
  const blank = timeline.items.length === 0 || (onlyItem !== undefined && isBlankFrame(s.frames[onlyItem.frameId]))

  const addRow = () => focusSoon(cellSelector(project.appendFrame(cutId)))

  const onRowDrop = (targetId: string, side: 'before' | 'after') => {
    if (drag && drag.frameId !== targetId) project.moveFrameNextTo(drag.frameId, targetId, side, cutId)
    setDrag(null)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <h1 className="text-[14px] font-semibold text-fg">Script</h1>
        <span className="text-fg-3">·</span>
        <span className="truncate text-fg-2">{cut?.name}</span>
        <span className={cx('text-[12px] tabular-nums', over ? 'font-medium text-warn' : 'text-fg-2')}>
          {formatSeconds(timeline.total)}
          {target !== null && <span className="text-fg-3"> of {formatSeconds(target)}</span>}
        </span>
        {words > 0 && (
          <span className="text-[12px] text-fg-3" title={`About ${formatDuration(words / s.meta.wordsPerSecond)} spoken at ${s.meta.wordsPerSecond} words/s`}>
            {words} {words === 1 ? 'word' : 'words'} of VO
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            size="sm"
            label={showText ? 'Hide the on-screen text column' : 'Show the on-screen text column'}
            active={showText}
            onClick={() => setTextPref(showText ? '0' : '1')}
          >
            <Type size={15} />
          </IconButton>
          <Button size="sm" variant="ghost" icon={<LayoutGrid size={14} />} onClick={() => navigate(projectPath(projectId, 'board'))}>
            Board
          </Button>
          <Button size="sm" icon={<ClipboardPaste size={14} />} onClick={() => setPasteOpen(true)}>
            Paste a script
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1180px] px-6 pt-5 pb-16">
          {blank && (
            <div className="mb-5 flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">Write the ad as rows of picture and sound</p>
                <p className="mt-0.5 text-fg-2">
                  Each row is a frame on the board, in this cut's order. Already have a script in Word, Docs or Sheets? Paste it
                  and the rows become frames.
                </p>
              </div>
              <Button variant="primary" icon={<ClipboardPaste size={14} />} onClick={() => setPasteOpen(true)}>
                Paste a script
              </Button>
            </div>
          )}

          <div
            role="table"
            aria-label="AV script"
            className="grid"
            style={{
              gridTemplateColumns: `92px minmax(200px, 1fr) minmax(200px, 1fr)${showText ? ' minmax(150px, 0.7fr)' : ''} 88px 36px`,
            }}
          >
            <div role="row" className="contents">
              {['Shot', 'Video', 'Audio', ...(showText ? ['On-screen text'] : []), 'Length', ''].map((h, i) => (
                <div
                  key={i}
                  role="columnheader"
                  className="sticky top-0 z-10 border-b border-line bg-bg px-2 pt-1 pb-2 text-[11px] font-medium tracking-wide text-fg-3 uppercase"
                >
                  {h}
                </div>
              ))}
            </div>
            {timeline.items.map((item) => (
              <Row
                key={item.frameId}
                item={item}
                label={labels.get(item.frameId) ?? '—'}
                cutId={cutId}
                showText={showText}
                dropSide={drag?.target === item.frameId && drag.frameId !== item.frameId ? drag.side : null}
                onDragStart={() => setDrag({ frameId: item.frameId, target: null, side: 'after' })}
                onDragOverRow={(side) => setDrag((d) => (d && (d.target !== item.frameId || d.side !== side) ? { ...d, target: item.frameId, side } : d))}
                onDragEnd={() => setDrag(null)}
                onDrop={(side) => onRowDrop(item.frameId, side)}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={addRow}>
              Add row
            </Button>
            <span className="text-[12px] text-fg-3">
              <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> in a row adds the next one
            </span>
          </div>
          {offCut > 0 && (
            <p className="mt-6 text-[12px] text-fg-3">
              {offCut} {offCut === 1 ? 'frame on the board isn’t' : 'frames on the board aren’t'} in this cut (other variations, or not linked
              yet).
            </p>
          )}
        </div>
      </div>
      <PasteScript open={pasteOpen} onOpenChange={setPasteOpen} cutId={cutId} />
    </div>
  )
}

function Row({
  item,
  label,
  cutId,
  showText,
  dropSide,
  onDragStart,
  onDragOverRow,
  onDragEnd,
  onDrop,
}: {
  item: TimelineItem
  label: string
  cutId: string
  showText: boolean
  dropSide: 'before' | 'after' | null
  onDragStart: () => void
  onDragOverRow: (side: 'before' | 'after') => void
  onDragEnd: () => void
  onDrop: (side: 'before' | 'after') => void
}) {
  const s = useSnapshot()
  const project = useProject()
  const { projectId } = useProjectContext()
  const frame = s.frames[item.frameId]
  const id = item.frameId

  useEffect(() => claimFocus(cellSelector(id)), [id])

  if (!frame) return null
  const labels = shotLabels(s)
  const g = graphOf(s)
  const linkIn = item.linkInId ? s.links[item.linkInId] : undefined
  const siblings = linkIn ? g.out(linkIn.from) : []
  const hero = frame.media.find((m) => m.id === frame.heroMediaId)
  const heroAsset = hero ? s.assets[hero.assetId] : undefined
  const words = frame.audio.reduce((n, l) => n + countWords(l.text), 0)

  const showOnBoard = () => {
    revealOnBoard(id)
    navigate(projectPath(projectId, 'board'))
  }
  const insertAfter = () => focusSoon(cellSelector(project.insertFrameAfter(id, { cutId })))
  const insertBefore = () => focusSoon(cellSelector(project.insertFrameBefore(id, { cutId })))
  // The cut switches to the new variation so it can be written in place; the swap control switches back.
  const addVariation = () =>
    focusSoon(
      cellSelector(
        project.transact(() => {
          const variation = project.addVariation(id)
          project.routeThrough(cutId, variation)
          return variation
        }),
      ),
    )

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.currentTarget.blur()
      if (e.shiftKey) addVariation()
      else insertAfter()
    }
  }

  const sideOf = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const dropProps = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(ROW_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      onDragOverRow(sideOf(e))
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(ROW_MIME)) return
      e.preventDefault()
      onDrop(sideOf(e))
    },
  }

  const cell = cx(
    'relative border-b border-line px-0.5 py-1.5',
    item.hidden && 'opacity-50',
    dropSide === 'before' && 'shadow-[inset_0_2px_0_var(--accent)]',
    dropSide === 'after' && 'shadow-[inset_0_-2px_0_var(--accent)]',
  )

  return (
    <div role="row" className="group contents">
      <div role="cell" className={cx(cell, 'flex flex-col gap-1.5 pl-1')} {...dropProps}>
        <div className="flex items-center gap-1">
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ROW_MIME, id)
              e.dataTransfer.effectAllowed = 'move'
              onDragStart()
            }}
            onDragEnd={onDragEnd}
            title="Drag to reorder"
            className="-ml-1 flex h-6 w-4 cursor-grab items-center justify-center text-fg-3 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical size={13} aria-hidden />
          </span>
          <span className="rounded bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-strong tabular-nums">{label}</span>
          <span className="text-[11px] text-fg-3 tabular-nums">{formatSeconds(item.start)}</span>
        </div>
        <button
          type="button"
          onClick={showOnBoard}
          title="Show on the board"
          className="ml-3 block w-[64px] overflow-hidden rounded border border-line bg-media hover:border-line-strong"
          style={{ aspectRatio: s.meta.aspect.replace(':', ' / ') }}
        >
          {heroAsset ? <MediaFill media={{ hash: heroAsset.hash, kind: heroAsset.kind }} size={320} /> : null}
        </button>
        {siblings.length > 1 && (
          <div className="ml-3 flex flex-wrap gap-0.5" role="radiogroup" aria-label="Variation used in this cut">
            {siblings.map((l) => (
              <Tooltip key={l.id} content={l.to === id ? 'Used in this cut' : 'Use this variation in this cut'}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={l.to === id}
                  onClick={() => l.to !== id && project.chooseLink(cutId, l.id)}
                  className={cx(
                    'h-5 rounded px-1 text-[10px] font-semibold tabular-nums',
                    l.to === id ? 'bg-accent text-accent-fg' : 'bg-hover text-fg-2 hover:text-fg',
                  )}
                >
                  {labels.get(l.to) ?? '?'}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        {item.hidden && <span className="ml-3 text-[10px] font-medium text-fg-3">Hidden in this cut</span>}
      </div>

      <div role="cell" className={cell} {...dropProps}>
        <BoundTextarea
          data-script-cell={id}
          bindKey={`${id}:description`}
          resolve={() => project.frameText(id, 'description')}
          autoGrow
          rows={1}
          placeholder="What we see"
          aria-label={`Video, shot ${label}`}
          onKeyDown={onKey}
          className={cellClass}
        />
      </div>

      <div role="cell" className={cx(cell, 'flex flex-col')} {...dropProps}>
        {frame.audio.length === 0 ? (
          <BoundTextarea
            bindKey={`${id}:vo:none`}
            resolve={() => null}
            create={(initial) => {
              project.setVo(id, initial)
              return project.audioText(id, project.voLineId(id))
            }}
            autoGrow
            rows={1}
            placeholder="What we hear"
            aria-label={`Audio, shot ${label}`}
            onKeyDown={onKey}
            className={cellClass}
          />
        ) : (
          frame.audio.map((line) => {
            const speaker = line.speaker.trim() || (line.kind === 'vo' ? 'VO' : 'Dialogue')
            const showSpeaker = frame.audio.length > 1 || line.speaker.trim() !== '' || line.kind !== 'vo'
            return (
              <div key={line.id}>
                {showSpeaker && <div className="px-2 pt-1 text-[10px] font-semibold tracking-wider text-fg-3 uppercase">{speaker}</div>}
                <BoundTextarea
                  bindKey={`${id}:audio:${line.id}`}
                  resolve={() => project.audioText(id, line.id)}
                  autoGrow
                  rows={1}
                  placeholder={line.kind === 'vo' ? 'What we hear' : 'What they say'}
                  aria-label={`${speaker}, shot ${label}`}
                  onKeyDown={onKey}
                  className={cx(cellClass, line.kind === 'vo' && 'italic')}
                />
              </div>
            )
          })
        )}
      </div>

      {showText && (
        <div role="cell" className={cell} {...dropProps}>
          <BoundTextarea
            bindKey={`${id}:onScreenText`}
            resolve={() => project.frameText(id, 'onScreenText')}
            autoGrow
            rows={1}
            placeholder="Supers, CTA"
            aria-label={`On-screen text, shot ${label}`}
            onKeyDown={onKey}
            className={cx(cellClass, 'font-medium')}
          />
        </div>
      )}

      <div role="cell" className={cx(cell, 'flex flex-col items-end gap-0.5 pr-1')} {...dropProps}>
        <div className="flex items-center gap-1">
          <SecondsInput
            label={`Length of shot ${label} in seconds`}
            value={frame.durationMode === 'manual' ? frame.duration : null}
            placeholder={String(Math.round(item.base * 10) / 10)}
            allowEmpty
            onCommit={(v) => (v === null ? project.resetDuration(id) : project.setDuration(id, v))}
            className="h-7 w-14 px-1.5 text-right text-[12px]"
          />
          <span className="text-[11px] text-fg-3">s</span>
        </div>
        <span className={cx('text-[10px]', item.overridden ? 'text-accent-strong' : 'text-fg-3')}>
          {item.overridden
            ? `${formatDuration(item.base)} in this cut`
            : frame.durationMode === 'manual'
              ? 'set by hand'
              : words > 0 || frame.audio.some((l) => l.assetId)
                ? 'from the VO'
                : 'default'}
        </span>
      </div>

      <div role="cell" className={cx(cell, 'flex justify-center pt-2')}>
        <Menu
          trigger={
            <IconButton size="sm" label={`Row ${label} options`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={[
            { label: 'Add row after', icon: <ArrowRightToLine size={14} />, shortcut: 'Ctrl Enter', onSelect: insertAfter },
            { label: 'Add row before', icon: <ArrowLeftToLine size={14} />, onSelect: insertBefore },
            {
              label: 'Add a variation',
              icon: <GitBranchPlus size={14} />,
              shortcut: 'Ctrl Shift Enter',
              onSelect: addVariation,
            },
            { label: 'Show on the board', icon: <LayoutGrid size={14} />, onSelect: showOnBoard },
            {
              label: item.hidden ? 'Show in this cut' : 'Hide in this cut',
              icon: item.hidden ? <Eye size={14} /> : <EyeOff size={14} />,
              onSelect: () => project.setHidden(cutId, id, !item.hidden),
            },
            'separator',
            { label: 'Delete row', icon: <Trash2 size={14} />, danger: true, onSelect: () => project.deleteFrames([id]) },
          ]}
        />
      </div>
    </div>
  )
}
