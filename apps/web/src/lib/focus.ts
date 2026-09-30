/**
 * Focus an element that may not exist yet: right away if it's on screen,
 * otherwise as soon as its component mounts and calls `claimFocus`. Used when
 * a command creates something (a frame, a script row) that should get the caret.
 */
let pending: string | null = null

function tryFocus(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.focus({ preventScroll: false })
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length)
  return true
}

export function focusSoon(selector: string): void {
  pending = tryFocus(selector) ? null : selector
}

export function claimFocus(selector: string): void {
  if (pending === selector && tryFocus(selector)) pending = null
}
