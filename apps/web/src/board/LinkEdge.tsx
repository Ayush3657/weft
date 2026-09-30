import { TRANSITIONS, findOption, formatSeconds, type LinkSnapshot } from '@weft/model'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react'
import { Scissors } from 'lucide-react'
import { memo } from 'react'
import { cx } from '../lib/cx'
import { useBoardActions } from './actions'

export interface LinkEdgeData extends Record<string, unknown> {
  link: LinkSnapshot
  inCut: boolean
  /** When the target frame starts in the selected cut. */
  start: number | null
  /** A frame is being dragged over this link and will be inserted here on drop. */
  dropTarget: boolean
}

export type LinkEdgeType = Edge<LinkEdgeData, 'link'>

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const LABEL_HEIGHT = 20
const LABEL_GAP = 5

/**
 * Where to put a label of the given size so it sits beside the line, not on
 * it: pushed out along the line's upward normal by just enough to clear it.
 */
function besideLine(sx: number, sy: number, tx: number, ty: number, mx: number, my: number, width: number) {
  const dx = tx - sx
  const dy = ty - sy
  const length = Math.hypot(dx, dy) || 1
  let nx = dy / length
  let ny = -dx / length
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  const offset = Math.abs(nx) * (width / 2) + Math.abs(ny) * (LABEL_HEIGHT / 2) + LABEL_GAP
  return { x: mx + nx * offset, y: my + ny * offset }
}

export const LinkEdge = memo(function LinkEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<LinkEdgeType>) {
  const actions = useBoardActions()
  const [path, midX, midY] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  if (!data) return null
  const { link, inCut, start, dropTarget } = data

  const transition = link.transition === 'cut' ? null : (findOption(TRANSITIONS, link.transition)?.short ?? null)
  const parts = [
    inCut && start !== null ? formatSeconds(start) : null,
    transition,
    link.note ? truncate(link.note, 22) : null,
  ].filter((part): part is string => part !== null)
  const text = dropTarget ? 'Insert here' : parts.join(' · ')
  const showLabel = text.length > 0 || selected
  // Rough width for placement; the label sizes itself.
  const width = Math.max(28, text.length * 6.2 + 16) + (selected ? 26 : 0)
  const pos = besideLine(sourceX, sourceY, targetX, targetY, midX, midY, width)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="weft-link-path"
        interactionWidth={18}
        style={{
          stroke: dropTarget || selected ? 'var(--accent-strong)' : inCut ? 'var(--accent)' : 'var(--line-strong)',
          strokeWidth: dropTarget ? 4 : inCut ? 2 : 1.5,
          strokeDasharray: inCut || dropTarget ? undefined : '6 5',
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-0.5"
            style={{ transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`, pointerEvents: 'all' }}
          >
            {text && (
              <button
                type="button"
                onClick={(e) => (e.altKey ? actions.cutLink(id) : actions.selectLink(id))}
                title={link.note || 'Edit this link (Alt+click to cut it)'}
                className={cx(
                  'rounded-md border px-1.5 py-[2px] text-[10.5px] font-medium whitespace-nowrap tabular-nums transition-colors',
                  dropTarget
                    ? 'border-accent bg-accent text-accent-fg'
                    : selected
                      ? 'border-accent bg-accent-soft text-fg'
                      : inCut
                        ? 'border-transparent bg-canvas/80 text-fg-2 hover:border-line hover:text-fg'
                        : 'border-transparent bg-canvas/80 text-fg-3 hover:text-fg-2',
                )}
              >
                {text}
              </button>
            )}
            {selected && !dropTarget && (
              <button
                type="button"
                onClick={() => actions.cutLink(id)}
                title="Cut this link (Delete)"
                aria-label="Cut this link"
                className="flex size-[22px] items-center justify-center rounded-md border border-line-strong bg-panel text-fg-2 hover:border-danger hover:text-danger"
              >
                <Scissors size={12} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
