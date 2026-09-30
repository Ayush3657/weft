import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge about the design tokens so `text-fg-2` (a color) doesn't
// get mistaken for a font size and dropped next to `text-[12px]`.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'bg',
        'panel',
        'raised',
        'hover',
        'active',
        'line',
        'line-strong',
        'fg',
        'fg-2',
        'fg-3',
        'accent',
        'accent-strong',
        'accent-soft',
        'accent-fg',
        'warn',
        'warn-soft',
        'danger',
        'danger-soft',
        'ok',
        'canvas',
        'media',
      ],
    },
  },
})

/** Joins class names; later classes override conflicting earlier ones (e.g. `h-8` then `h-7`). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return merge(parts.filter(Boolean).join(' '))
}
