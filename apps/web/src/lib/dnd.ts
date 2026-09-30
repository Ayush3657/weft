import type { DragEvent } from 'react'

/** Dragging assets out of the Library onto frames, the moodboard, notes and the bible. */
export const ASSET_MIME = 'application/x-weft-asset'

export function startAssetDrag(e: DragEvent, assetIds: string[]): void {
  e.dataTransfer.setData(ASSET_MIME, assetIds.join(','))
  e.dataTransfer.effectAllowed = 'copy'
}

/** True while dragging assets (the ids themselves are only readable on drop). */
export function isAssetDrag(dt: DataTransfer | null): boolean {
  return !!dt && dt.types.includes(ASSET_MIME)
}

export function droppedAssetIds(dt: DataTransfer | null): string[] {
  const raw = dt?.getData(ASSET_MIME)
  return raw ? raw.split(',').filter(Boolean) : []
}

/** Files or Library assets: either can be dropped on media targets. */
export function isMediaDrag(dt: DataTransfer | null): boolean {
  return !!dt && (dt.types.includes('Files') || dt.types.includes(ASSET_MIME))
}
