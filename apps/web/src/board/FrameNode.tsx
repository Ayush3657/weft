import { CAMERA_MOVES, SHOT_SIZES, findOption, formatDuration, type AssetKind, type FrameSnapshot } from '@weft/model'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Check, GitBranchPlus, Plus } from 'lucide-react'
import { memo, useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { cx } from '../lib/cx'
import { mediaFiles } from '../lib/media'
import { BoundTextarea } from '../project/BoundText'
import { useProjectContext } from '../project/ProjectProvider'
import { claimPendingFocus, useBoardActions } from './actions'
import { EmptyMedia, MediaFill } from './Media'
import type { CardSize } from './sizes'

export interface FrameNodeData extends Record<string, unknown> {
  frame: FrameSnapshot
  label: string | null
  /** Seconds shown on the card: this cut's length (with override) or the frame's own. */
  duration: number
  overridden: boolean
  inCut: boolean
  hiddenInCut: boolean
  hero: { hash: string | null; kind: AssetKind } | null
  refs: ReadonlyArray<{ id: string; hash: string | null; kind: AssetKind; title: string }>
  size: CardSize
}

export type FrameNodeType = Node<FrameNodeData, 'frame'>

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

function Chip({ children, title }: { children: string; title: string }) {
  return (
    <span title={title} className="rounded border border-line px-1 py-px text-[10px] font-medium text-fg-2">
      {children}
    </span>
  )
}

export const FrameNode = memo(function FrameNode({ id, data, selected }: NodeProps<FrameNodeType>) {
  const { project } = useProjectContext()
  const actions = useBoardActions()
  const { frame, label, duration, overridden, inCut, hiddenInCut, hero, refs, size } = data
  const [dropTarget, setDropTarget] = useState<'media' | 'references' | null>(null)
  const vo = frame.audio.find((line) => line.kind === 'vo')
  const shot = findOption(SHOT_SIZES, frame.shotSize)
  const move = findOption(CAMERA_MOVES, frame.movement)

  useEffect(() => claimPendingFocus(id), [id])

  const dropProps = (target: 'media' | 'references') => ({
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setDropTarget(target)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropTarget(null)
    },
    onDrop: (e: DragEvent) => {
      setDropTarget(null)
      const files = mediaFiles(e.dataTransfer)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      actions.importToFrame(id, files, target)
    },
  })

  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      // Let go of this field first, so fast typing never lands in the old frame.
      e.currentTarget.blur()
      if (e.shiftKey) actions.addVariation(id)
      else actions.insertAfter(id)
    } else if (e.key === 'Escape') {
      e.currentTarget.blur()
    }
  }

  return (
    <div className="group relative" style={{ width: size.width, height: size.height }}>
      <Handle type="target" position={Position.Left} />
      <div
        className={cx(
          'flex h-full flex-col overflow-hidden rounded-xl border bg-raised transition-[border-color,box-shadow,opacity]',
          selected
            ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]'
            : inCut
              ? 'border-line-strong'
              : 'border-dashed border-line-strong opacity-70 hover:opacity-100',
        )}
      >
        <div
          className={cx('relative shrink-0 bg-media', dropTarget === 'media' && 'ring-2 ring-accent ring-inset')}
          style={{ height: size.imageHeight }}
          {...dropProps('media')}
        >
          {hero ? <MediaFill media={hero} /> : <EmptyMedia />}
          {hiddenInCut && (
            <span className="absolute top-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
              Hidden in this cut
            </span>
          )}
          {frame.status === 'approved' && (
            <span
              className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-ok text-white"
              title="Approved"
            >
              <Check size={12} strokeWidth={3} aria-label="Approved" />
            </span>
          )}
        </div>

        <div className="flex h-[30px] shrink-0 items-center gap-1.5 px-2.5">
          <span
            className={cx(
              'rounded px-1.5 py-px text-[11px] font-semibold tabular-nums',
              inCut ? 'bg-accent-soft text-accent-strong' : 'bg-hover text-fg-2',
            )}
          >
            {label ?? '—'}
          </span>
          {shot && <Chip title={shot.label}>{shot.short}</Chip>}
          {move && move.id !== 'static' && <Chip title={move.label}>{move.short}</Chip>}
          <span
            className={cx('ml-auto text-[11px] tabular-nums', overridden ? 'text-accent-strong' : 'text-fg-2')}
            title={overridden ? 'Length set for this cut' : frame.durationMode === 'auto' ? 'Automatic length' : 'Manual length'}
          >
            {formatDuration(duration)}
          </span>
        </div>

        <BoundTextarea
          data-frame-text={id}
          bindKey={`${id}:description`}
          resolve={() => project.frameText(id, 'description')}
          rows={2}
          placeholder="What happens in this shot?"
          aria-label="Shot description"
          onKeyDown={onTextKey}
          className="weft-card-text nodrag nowheel mx-1.5 h-[42px] shrink-0 overflow-y-auto rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] leading-[1.38] text-fg placeholder:text-fg-3 hover:border-line focus:border-accent focus:bg-bg focus:outline-none"
        />

        <div className="mx-1.5 mt-0.5 flex h-[42px] shrink-0 items-start rounded-md border border-transparent px-1.5 hover:border-line focus-within:border-accent focus-within:bg-bg">
          <span className="mt-[5px] mr-1.5 shrink-0 text-[9px] font-bold tracking-wider text-fg-3">VO</span>
          <BoundTextarea
            bindKey={`${id}:vo:${vo?.id ?? 'none'}`}
            resolve={() => (vo ? project.audioText(id, vo.id) : null)}
            create={(initial) => {
              project.setVo(id, initial)
              return project.audioText(id, project.voLineId(id))
            }}
            rows={2}
            placeholder="Voiceover"
            aria-label="Voiceover"
            onKeyDown={onTextKey}
            className="weft-card-text nodrag nowheel h-[40px] flex-1 overflow-y-auto bg-transparent py-1 text-[12px] leading-[1.38] text-fg-2 italic placeholder:text-fg-3 placeholder:not-italic focus:outline-none"
          />
        </div>

        <div
          className={cx(
            'mt-auto flex h-[36px] shrink-0 items-center gap-1 border-t border-line px-2',
            dropTarget === 'references' && 'bg-accent-soft',
          )}
          {...dropProps('references')}
        >
          {refs.length ? (
            <>
              {refs.slice(0, 6).map((ref) => (
                <div key={ref.id} className="size-6 shrink-0 overflow-hidden rounded border border-line bg-media" title={ref.title}>
                  <MediaFill media={ref} />
                </div>
              ))}
              {refs.length > 6 && <span className="text-[11px] text-fg-3">+{refs.length - 6}</span>}
            </>
          ) : (
            <span className="text-[11px] text-fg-3">Drop references here</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />

      <button
        type="button"
        onClick={() => actions.insertAfter(id)}
        title="Add the next frame (Enter)"
        aria-label="Add the next frame"
        className="nodrag absolute -right-[42px] flex size-7 items-center justify-center rounded-full border border-line-strong bg-panel text-fg-2 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 hover:border-accent hover:text-fg focus-visible:opacity-100"
        style={{ top: size.imageHeight / 2 - 14 }}
      >
        <Plus size={15} />
      </button>
      <button
        type="button"
        onClick={() => actions.addVariation(id)}
        title="Add a variation of this frame (Shift+Enter)"
        className="nodrag absolute -bottom-[15px] left-1/2 flex h-[26px] -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-panel px-2.5 text-[11px] font-medium text-fg-2 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 hover:border-accent hover:text-fg focus-visible:opacity-100"
      >
        <GitBranchPlus size={13} aria-hidden />
        Variation
      </button>
    </div>
  )
})
