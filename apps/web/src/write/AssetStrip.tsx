import { Plus } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { droppedAssetIds, isMediaDrag } from '../lib/dnd'
import { importFiles, mediaFiles } from '../lib/media'
import { useProject, useSnapshot } from '../project/hooks'
import { Thumb, useFilePicker } from '../ui/inputs'

/**
 * A grid of pictures with an add button. Takes files (picked, dropped or
 * pasted) and assets dragged from the Library.
 */
export function AssetStrip({
  assetIds,
  onAdd,
  onRemove,
  empty,
  columns = 5,
  accept = 'image/*,video/*',
}: {
  assetIds: readonly string[]
  onAdd: (assetIds: string[]) => void
  onRemove: (assetId: string) => void
  empty?: string
  columns?: number
  accept?: string
}) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const [over, setOver] = useState(false)
  const addFiles = async (files: File[]) => {
    const ids = await importFiles(project, files, user.id)
    if (ids.length) onAdd(ids)
  }
  const picker = useFilePicker((files) => void addFiles(files), accept)

  const onDragOver = (e: DragEvent) => {
    if (!isMediaDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    setOver(false)
    const files = mediaFiles(e.dataTransfer)
    const ids = droppedAssetIds(e.dataTransfer)
    if (!files.length && !ids.length) return
    e.preventDefault()
    e.stopPropagation()
    if (files.length) void addFiles(files)
    else onAdd(ids)
  }

  const shown = assetIds.filter((id) => s.assets[id])
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={onDrop}
      className={cx('rounded-lg transition-colors', over && 'bg-accent-soft ring-2 ring-accent')}
    >
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {shown.map((id) => {
          const asset = s.assets[id]!
          return (
            <Thumb
              key={id}
              media={{ hash: asset.hash, kind: asset.kind, title: asset.name }}
              label={asset.title || asset.name || 'Picture'}
              onRemove={() => onRemove(id)}
            />
          )
        })}
        <button
          type="button"
          onClick={picker.open}
          aria-label="Add pictures"
          title="Add pictures, or drop them here (from your computer or the Library)"
          className="flex aspect-square items-center justify-center rounded-md border border-dashed border-line-strong text-fg-3 hover:border-accent hover:text-fg"
        >
          <Plus size={16} />
        </button>
      </div>
      {shown.length === 0 && empty && <p className="mt-2 text-[12px] text-fg-3">{empty}</p>}
      {picker.input}
    </div>
  )
}
