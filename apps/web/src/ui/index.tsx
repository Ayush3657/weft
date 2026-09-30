import { Loader2, X } from 'lucide-react'
import { ContextMenu, Dialog, DropdownMenu, Tooltip as TooltipPrimitive } from 'radix-ui'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { cx } from '../lib/cx'

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-strong border-transparent',
  secondary: 'bg-raised text-fg border-line-strong hover:bg-hover',
  ghost: 'bg-transparent text-fg-2 border-transparent hover:bg-hover hover:text-fg',
  danger: 'bg-danger-soft text-danger border-transparent hover:bg-danger hover:text-white',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 gap-1.5 text-[12px]',
  md: 'h-8 px-3 gap-2 text-[13px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md border font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tooltip?: ReactNode
  active?: boolean
  size?: Size
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip, active, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-8',
        active && 'bg-active text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>
})

// ------------------------------------------------------------------- fields

const fieldBase =
  'w-full rounded-md border border-line bg-bg px-2.5 text-fg placeholder:text-fg-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, 'h-8', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(fieldBase, 'h-8 cursor-pointer pr-7', className)} {...rest}>
      {children}
    </select>
  )
})

export const textareaClass = cx(fieldBase, 'block py-1.5 leading-[1.45]')

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">
          {label}
        </label>
        {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** A row of mutually exclusive options. Clicking the active one clears it when `allowClear` is set. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  allowClear = false,
  size = 'md',
  label,
}: {
  options: ReadonlyArray<{ id: T; label: string; title?: string }>
  value: T | null
  onChange: (value: T | null) => void
  allowClear?: boolean
  size?: Size
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(active && allowClear ? null : o.id)}
            className={cx(
              'rounded-md border font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
              active
                ? 'border-accent bg-accent-soft text-fg'
                : 'border-line bg-transparent text-fg-2 hover:border-line-strong hover:text-fg',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ overlays

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md border border-line-strong bg-raised px-2 py-1 text-[12px] text-fg shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export const TooltipProvider = TooltipPrimitive.Provider

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 440,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  width?: number
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line-strong bg-panel p-5 shadow-pop focus:outline-none"
          style={{ maxWidth: width }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-fg-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="-mt-1 -mr-1 rounded-md p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">
              <X size={15} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  shortcut?: string
}

const menuContentClass = 'z-50 min-w-48 rounded-lg border border-line-strong bg-raised p-1 shadow-pop'
const menuItemClass =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-hover'

function MenuItemContent({ item }: { item: MenuItem }) {
  return (
    <>
      <span className="flex w-4 justify-center text-fg-2">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.shortcut && <span className="pl-4 text-[11px] text-fg-3">{item.shortcut}</span>}
      {item.checked && <span className="size-1.5 rounded-full bg-accent" aria-label="Current" />}
    </>
  )
}

/** Right-click menu for whatever it wraps. */
export function ContextMenuArea({ items, children }: { items: Array<MenuItem | 'separator'>; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <ContextMenu.Separator key={`sep-${i}`} className="my-1 h-px bg-line" />
            ) : (
              <ContextMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={() => window.setTimeout(item.onSelect, 0)}
                className={cx(menuItemClass, item.danger ? 'text-danger' : 'text-fg')}
              >
                <MenuItemContent item={item} />
              </ContextMenu.Item>
            ),
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function Menu({
  trigger,
  items,
  align = 'end',
  header,
}: {
  trigger: ReactNode
  items: Array<MenuItem | 'separator'>
  align?: 'start' | 'end' | 'center'
  header?: ReactNode
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={menuContentClass}>
          {header && <div className="px-2.5 pt-1.5 pb-2 text-[12px] text-fg-3">{header}</div>}
          {items.map((item, i) =>
            item === 'separator' ? (
              <DropdownMenu.Separator key={`sep-${i}`} className="my-1 h-px bg-line" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                disabled={item.disabled}
                // Run after the menu has closed and handed focus back, so an action
                // that opens a dialog isn't immediately closed by that focus change.
                onSelect={() => window.setTimeout(item.onSelect, 0)}
                className={cx(menuItemClass, item.danger ? 'text-danger' : 'text-fg')}
              >
                <MenuItemContent item={item} />
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// -------------------------------------------------------------------- bits

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-bg px-1 font-sans text-[10px] font-medium text-fg-2">
      {children}
    </kbd>
  )
}

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-fg-2" role="status">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label && <span>{label}</span>}
    </div>
  )
}

export function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center">{children}</div>
}
