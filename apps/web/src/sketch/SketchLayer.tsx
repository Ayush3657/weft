import { SKETCH_PAPER, SKETCH_WIDTH, sketchHeight, strokeShapes, type SketchShape, type SketchStroke } from '@weft/model'
import { memo, useSyncExternalStore, type ReactNode } from 'react'
import { cx } from '../lib/cx'

/** The paper a sketch on a frame without a picture is drawn on. */
export const PAPER = SKETCH_PAPER

/** How each stroke is drawn, worked out once per stroke. */
const drawn = new WeakMap<SketchStroke, SketchShape[]>()

export function shapesOf(stroke: SketchStroke): SketchShape[] {
  let shapes = drawn.get(stroke)
  if (!shapes) {
    shapes = strokeShapes(stroke)
    drawn.set(stroke, shapes)
  }
  return shapes
}

export function StrokePaths({ stroke, faded }: { stroke: SketchStroke; faded?: boolean }) {
  return (
    <g opacity={faded ? 0.25 : undefined}>
      {shapesOf(stroke).map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill={shape.fill ?? 'none'}
          stroke={shape.stroke ?? undefined}
          strokeWidth={shape.stroke ? shape.width : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  )
}

/** A frame's sketch, laid over whatever fills its box (the box must have the frame's shape). */
export const SketchLayer = memo(function SketchLayer({
  strokes,
  aspect,
  cover = false,
  className,
  children,
}: {
  strokes: readonly SketchStroke[]
  aspect: number
  /** In a box of another shape, fill it the way a picture does (cropping), rather than matching it exactly. */
  cover?: boolean
  className?: string
  /** Drawn on top: a stroke being drawn, the eraser. */
  children?: ReactNode
}) {
  if (!strokes.length && !children) return null
  return (
    <svg
      viewBox={`0 0 ${SKETCH_WIDTH} ${sketchHeight(aspect)}`}
      preserveAspectRatio={cover ? 'xMidYMid slice' : 'none'}
      aria-hidden
      className={cx('pointer-events-none absolute inset-0 size-full overflow-visible', className)}
    >
      {strokes.map((stroke) => (
        <StrokePaths key={stroke.id} stroke={stroke} />
      ))}
      {children}
    </svg>
  )
})

// ------------------------------------------------------------ the editor

let editing: string | null = null
const listeners = new Set<() => void>()

function edit(frameId: string | null): void {
  editing = frameId
  for (const listener of [...listeners]) listener()
}

/** Opens the sketch editor on a frame, from anywhere in the project. */
export const openSketch = (frameId: string) => edit(frameId)

export const closeSketch = () => edit(null)

/** The frame being sketched on, if any. */
export function useSketching(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => editing,
  )
}
