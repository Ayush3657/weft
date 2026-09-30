import { useCallback, useSyncExternalStore } from 'react'

/** Per-browser conveniences (theme, last cut, last sign-in name). Never project data. */
const listeners = new Set<() => void>()

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`weft:${key}`)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`weft:${key}`)
    else localStorage.setItem(`weft:${key}`, value)
  } catch {
    // Storage can be unavailable (private windows, blocked site data); prefs are optional.
  }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePref(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => readPref(key))
  const set = useCallback((next: string | null) => writePref(key, next), [key])
  return [value, set]
}

export type Theme = 'dark' | 'light'

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [value, setValue] = usePref('theme')
  const theme: Theme = value === 'light' ? 'light' : 'dark'
  const setTheme = useCallback(
    (next: Theme) => {
      document.documentElement.dataset.theme = next
      setValue(next)
    },
    [setValue],
  )
  return [theme, setTheme]
}
