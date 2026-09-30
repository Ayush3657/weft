import { createContext, useContext } from 'react'

/** Board-level actions that frame cards and link labels can trigger. */
export interface BoardActions {
  insertAfter(frameId: string): void
  addVariation(frameId: string): void
  selectLink(linkId: string): void
  importToFrame(frameId: string, files: File[], target: 'media' | 'references'): void
}

export const BoardActionsContext = createContext<BoardActions | null>(null)

export function useBoardActions(): BoardActions {
  const value = useContext(BoardActionsContext)
  if (!value) throw new Error('useBoardActions must be used inside the board')
  return value
}

let pendingFocus: string | null = null

function focusElement(frameId: string): boolean {
  const el = document.querySelector<HTMLTextAreaElement>(`[data-frame-text="${frameId}"]`)
  if (!el) return false
  el.focus({ preventScroll: true })
  el.setSelectionRange(el.value.length, el.value.length)
  return true
}

/**
 * Puts the caret in a frame's description: right away if its card exists,
 * otherwise as soon as the card mounts (see `claimPendingFocus`).
 */
export function focusFrameText(frameId: string): void {
  pendingFocus = focusElement(frameId) ? null : frameId
}

/** Called by a frame card when it mounts; focuses it if focus was requested before it existed. */
export function claimPendingFocus(frameId: string): void {
  if (pendingFocus === frameId && focusElement(frameId)) pendingFocus = null
}
