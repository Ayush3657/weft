import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cx } from './cx'

type Tone = 'info' | 'error' | 'ok'
export interface ToastAction {
  label: string
  run: () => void
}

interface Toast {
  id: number
  message: string
  tone: Tone
  action?: ToastAction
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of [...listeners]) listener()
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function toast(message: string, tone: Tone = 'info', action?: ToastAction): void {
  const id = nextId++
  toasts = [...toasts.filter((t) => t.message !== message), { id, message, tone, action }].slice(-4)
  emit()
  setTimeout(() => dismissToast(id), tone === 'error' ? 6000 : action ? 6000 : 3500)
}

export function toastError(error: unknown, fallback = 'Something went wrong'): void {
  toast(error instanceof Error && error.message ? error.message : fallback, 'error')
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const ICONS = { info: Info, error: CircleAlert, ok: CircleCheck }

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2" aria-live="polite">
      {list.map((t) => {
        const Icon = ICONS[t.tone]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border border-line-strong bg-raised py-2 pr-2 pl-3 shadow-pop"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon
              size={15}
              className={cx('shrink-0', t.tone === 'error' ? 'text-danger' : t.tone === 'ok' ? 'text-ok' : 'text-fg-2')}
              aria-hidden
            />
            <span className="text-fg">{t.message}</span>
            {t.action && (
              <button
                className="rounded px-1.5 py-0.5 font-medium text-accent-strong hover:bg-hover"
                onClick={() => {
                  dismissToast(t.id)
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
