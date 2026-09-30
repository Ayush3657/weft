export type TimeFormat = 'seconds' | 'timecode' | 'frames'

/** 0:06, 0:09.5, 1:02.3 */
export function formatSeconds(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600)
  const rest = tenths - minutes * 600
  const whole = Math.floor(rest / 10)
  const tenth = rest % 10
  return `${minutes}:${String(whole).padStart(2, '0')}${tenth ? `.${tenth}` : ''}`
}

/** SMPTE-style HH:MM:SS:FF (non-drop-frame). */
export function formatTimecode(seconds: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps))
  const totalFrames = Math.max(0, Math.round(seconds * rate))
  const ff = totalFrames % rate
  const totalSeconds = Math.floor(totalFrames / rate)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, '0')).join(':')
}

export function formatTime(seconds: number, format: TimeFormat, fps: number): string {
  switch (format) {
    case 'seconds':
      return formatSeconds(seconds)
    case 'timecode':
      return formatTimecode(seconds, fps)
    case 'frames':
      return `${Math.round(seconds * fps)}f`
  }
}

/** 2.9s, 12s */
export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`
}
