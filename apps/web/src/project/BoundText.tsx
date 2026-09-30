import { applyTextDiff } from '@weft/model'
import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type * as Y from 'yjs'
import { useProjectContext } from './ProjectProvider'

type TextElement = HTMLTextAreaElement | HTMLInputElement

/**
 * Two-way binding between a text field and a Y.Text. Local typing becomes
 * minimal edits; remote edits update the field and keep the caret in place.
 */
export function bindText(
  el: TextElement,
  ytext: Y.Text,
  transact: (fn: () => void) => void,
  onChange?: () => void,
): () => void {
  let applying = false
  const current = ytext.toString()
  if (el.value !== current) el.value = current

  const onInput = () => {
    applying = true
    try {
      transact(() => applyTextDiff(ytext, el.value))
    } finally {
      applying = false
    }
    onChange?.()
  }

  const onRemote = (event: Y.YTextEvent) => {
    if (applying) return
    let start = el.selectionStart ?? 0
    let end = el.selectionEnd ?? 0
    let index = 0
    for (const op of event.delta) {
      if (op.retain !== undefined) {
        index += op.retain
      } else if (op.insert !== undefined) {
        const length = typeof op.insert === 'string' ? op.insert.length : 1
        if (index < start) start += length
        if (index < end) end += length
        index += length
      } else if (op.delete !== undefined) {
        if (index < start) start -= Math.min(op.delete, start - index)
        if (index < end) end -= Math.min(op.delete, end - index)
      }
    }
    const next = ytext.toString()
    if (el.value !== next) {
      el.value = next
      if (document.activeElement === el) el.setSelectionRange(start, end)
    }
    onChange?.()
  }

  el.addEventListener('input', onInput)
  ytext.observe(onRemote)
  return () => {
    el.removeEventListener('input', onInput)
    ytext.unobserve(onRemote)
  }
}

interface BindingOptions {
  /** The Y.Text to edit, or null if it doesn't exist yet. */
  resolve: () => Y.Text | null
  /** Creates the Y.Text (with the typed text) on first input when `resolve` returned null. */
  create?: (initial: string) => Y.Text
  /** The binding is rebuilt when this changes (e.g. `${frameId}:description`). */
  bindKey: string
  autoGrow?: boolean
}

function useBinding(ref: React.RefObject<TextElement | null>, { resolve, create, bindKey, autoGrow }: BindingOptions) {
  const { project } = useProjectContext()
  const latest = useRef({ resolve, create })
  latest.current = { resolve, create }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const grow =
      autoGrow && el instanceof HTMLTextAreaElement
        ? () => {
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight + 2}px`
          }
        : undefined
    const transact = (fn: () => void) => project.transact(fn)
    let unbind: () => void
    const ytext = latest.current.resolve()
    if (ytext) {
      unbind = bindText(el, ytext, transact, grow)
    } else {
      el.value = ''
      const onFirstInput = () => {
        el.removeEventListener('input', onFirstInput)
        const created = latest.current.create?.(el.value)
        if (created) unbind = bindText(el, created, transact, grow)
      }
      el.addEventListener('input', onFirstInput)
      unbind = () => el.removeEventListener('input', onFirstInput)
    }
    grow?.()
    return () => unbind()
  }, [bindKey, project, ref, autoGrow])
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange'> &
  BindingOptions

export const BoundTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function BoundTextarea(
  { resolve, create, bindKey, autoGrow, ...rest },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(forwarded, () => ref.current!)
  useBinding(ref, { resolve, create, bindKey, autoGrow })
  return <textarea ref={ref} spellCheck {...rest} />
})

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> & BindingOptions

export const BoundInput = forwardRef<HTMLInputElement, InputProps>(function BoundInput(
  { resolve, create, bindKey, autoGrow, ...rest },
  forwarded,
) {
  const ref = useRef<HTMLInputElement>(null)
  useImperativeHandle(forwarded, () => ref.current!)
  useBinding(ref, { resolve, create, bindKey, autoGrow })
  return <input ref={ref} {...rest} />
})
