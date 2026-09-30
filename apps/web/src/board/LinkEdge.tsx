import { TRANSITIONS, findOption, formatSeconds, type LinkSnapshot } from '@weft/model'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'
import { cx } from '../lib/cx'
import { useBoardActions } from './actions'

export interface LinkEdgeData extends Record<string, unknown> {
  link: LinkSnapshot
  inCut: boolean
  /** When the target frame starts in the selected cut. */
  start: number | null
}

export type LinkEdgeType = Edge<LinkEdgeData, 'link'>

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const LinkEdge = memo(function LinkEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<LinkEdgeType>) {
  const actions = useBoardActions()
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  if (!data) return null
  const { link, inCut, start } = data
  const transition = findOption(TRANSITIONS, link.transition)?.short ?? 'Cut'
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="weft-link-path"
        interactionWidth={18}
        style={{
          stroke: selected ? 'var(--accent-strong)' : inCut ? 'var(--accent)' : 'var(--line-strong)',
          strokeWidth: inCut ? 2 : 1.5,
          strokeDasharray: inCut ? undefined : '6 5',
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => actions.selectLink(id)}
          title={link.note || 'Edit this link'}
          className={cx(
            'nodrag nopan absolute rounded-md border px-1.5 py-[2px] text-[10.5px] font-medium whitespace-nowrap tabular-nums transition-colors',
            selected
              ? 'border-accent bg-accent text-accent-fg'
              : inCut
                ? 'border-accent/40 bg-panel text-fg hover:border-accent'
                : 'border-line bg-panel text-fg-3 hover:text-fg-2',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
        >
          {inCut && start !== null && <span>{formatSeconds(start)} · </span>}
          <span>{transition}</span>
          {link.note && <span className="text-fg-3"> · {truncate(link.note, 22)}</span>}
        </button>
      </EdgeLabelRenderer>
    </>
  )
})
