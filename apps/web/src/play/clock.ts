import { useSyncExternalStore } from 'react'

/**
 * Playback time for the animatic. Anchored to the real clock (not summed per
 * frame), so it stays in step with audio even if frames are dropped or the
 * tab was in the background.
 */
export class PlaybackClock {
  loop = false
  private time = 0
  private playing = false
  private duration = 0
  private anchorNow = 0
  private anchorTime = 0
  private raf = 0
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getTime = (): number => this.time
  isPlaying = (): boolean => this.playing
  getDuration = (): number => this.duration

  play = (): void => {
    if (this.playing || this.duration <= 0) return
    if (this.time >= this.duration - 0.02) this.time = 0
    this.playing = true
    this.anchorNow = performance.now()
    this.anchorTime = this.time
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause = (): void => {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  toggle = (): void => (this.playing ? this.pause() : this.play())

  seek = (t: number): void => {
    this.time = Math.min(Math.max(0, t), this.duration)
    this.anchorNow = performance.now()
    this.anchorTime = this.time
    this.emit()
  }

  setDuration(duration: number): void {
    this.duration = Math.max(0, duration)
    if (this.time > this.duration) this.seek(this.duration)
    else this.emit()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.playing = false
    this.listeners.clear()
  }

  private tick = (): void => {
    if (!this.playing) return
    const t = this.anchorTime + (performance.now() - this.anchorNow) / 1000
    if (t >= this.duration) {
      if (this.loop && this.duration > 0) {
        this.anchorNow = performance.now()
        this.anchorTime = 0
        this.time = 0
      } else {
        this.time = this.duration
        this.playing = false
        this.emit()
        return
      }
    } else {
      this.time = t
    }
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const useClockTime = (clock: PlaybackClock): number => useSyncExternalStore(clock.subscribe, clock.getTime)

export const useClockPlaying = (clock: PlaybackClock): boolean => useSyncExternalStore(clock.subscribe, clock.isPlaying)

/** Re-renders only when `read()` returns a different value (keep it to primitives). */
export function useClockValue<T>(clock: PlaybackClock, read: () => T): T {
  return useSyncExternalStore(clock.subscribe, read)
}
