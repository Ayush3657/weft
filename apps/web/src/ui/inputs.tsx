import type { AssetKind } from '@weft/model'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { MediaFill } from '../board/Media'
import { cx } from '../lib/cx'
import { Input } from './index'

/** A text input that edits locally and saves on blur or Enter (Escape cancels). */
export function CommitInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          const el = e.currentTarget
          requestAnimationFrame(() => el.blur())
        }
      }}
      {...rest}
    />
  )
}

/** Seconds input; empty means "none" when `allowEmpty`. */
export function SecondsInput({
  value,
  onCommit,
  allowEmpty = false,
  placeholder,
  className,
  label,
}: {
  value: number | null
  onCommit: (value: number | null) => void
  allowEmpty?: boolean
  placeholder?: string
  className?: string
  label: string
}) {
  const format = (v: number | null) => (v === null ? '' : String(Math.round(v * 100) / 100))
  const [draft, setDraft] = useState(format(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(format(value))
  }, [value])
  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      if (allowEmpty) onCommit(null)
      else setDraft(format(value))
      return
    }
    const parsed = Number(trimmed.replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed)
    else setDraft(format(value))
  }
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={cx('tabular-nums', className)}
    />
  )
}

/** A square media thumbnail with an optional remove button. */
export function Thumb({
  media,
  active,
  onClick,
  onRemove,
  label,
}: {
  media: { hash: string | null; kind: AssetKind; title?: string }
  active?: boolean
  onClick?: () => void
  onRemove?: () => void
  label: string
}) {
  return (
    <div className="group/thumb relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cx(
          'block aspect-square w-full overflow-hidden rounded-md border bg-media',
          active ? 'border-accent ring-2 ring-accent-soft' : 'border-line hover:border-line-strong',
        )}
      >
        <MediaFill media={media} />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border border-line-strong bg-panel text-fg-2 group-hover/thumb:flex hover:text-danger"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

/** A hidden file input and a function that opens it. */
export function useFilePicker(onFiles: (files: File[]) => void, accept = 'image/*,video/*') {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      accept={accept}
      className="hidden"
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { open: () => ref.current?.click(), input }
}
