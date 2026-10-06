import { useState, type DragEvent } from 'react'

/** Dragging storyboards and folders around the projects page, to move them. */
const PROJECT_MIME = 'application/x-weft-project'
const FOLDER_MIME = 'application/x-weft-folder'

export type Dragged = { kind: 'project' | 'folder'; id: string }

export function startMoveDrag(e: DragEvent, dragged: Dragged): void {
  e.dataTransfer.setData(dragged.kind === 'project' ? PROJECT_MIME : FOLDER_MIME, dragged.id)
  e.dataTransfer.effectAllowed = 'move'
}

const isMoveDrag = (dt: DataTransfer) => dt.types.includes(PROJECT_MIME) || dt.types.includes(FOLDER_MIME)

function draggedFrom(dt: DataTransfer): Dragged | null {
  const project = dt.getData(PROJECT_MIME)
  if (project) return { kind: 'project', id: project }
  const folder = dt.getData(FOLDER_MIME)
  return folder ? { kind: 'folder', id: folder } : null
}

/** Props that make an element somewhere to drop storyboards and folders, and whether one is over it. */
export function useMoveTarget(onDrop: (dragged: Dragged) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isMoveDrag(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        setOver(false)
        const dragged = draggedFrom(e.dataTransfer)
        if (!dragged) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(dragged)
      },
    },
  }
}
