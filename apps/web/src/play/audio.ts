import type { AssetSnapshot, AudioClip } from '@weft/model'
import { useEffect, useRef } from 'react'
import { displayUrl } from '../lib/media'
import type { PlaybackClock } from './clock'

/** Keeps one audio element per clip playing in step with the clock. */
export function useAudioSync(
  clock: PlaybackClock,
  clips: readonly AudioClip[],
  assets: Readonly<Record<string, AssetSnapshot>>,
  muted: boolean,
): void {
  const elements = useRef(new Map<string, HTMLAudioElement>())

  useEffect(() => {
    const els = elements.current
    const wanted = new Map<string, AudioClip>()
    for (const clip of clips) {
      const hash = assets[clip.assetId]?.hash
      if (hash) wanted.set(`${clip.key}:${hash}`, clip)
    }
    for (const [key, el] of els) {
      if (!wanted.has(key)) {
        el.pause()
        el.removeAttribute('src')
        els.delete(key)
      }
    }
    for (const [key, clip] of wanted) {
      if (els.has(key)) continue
      const el = new Audio(displayUrl(assets[clip.assetId]!.hash!))
      el.preload = 'auto'
      els.set(key, el)
    }

    const sync = () => {
      const t = clock.getTime()
      const playing = clock.isPlaying()
      for (const [key, clip] of wanted) {
        const el = els.get(key)
        if (!el) continue
        el.volume = muted ? 0 : Math.min(1, Math.max(0, clip.volume))
        const local = t - clip.start
        if (playing && local >= 0 && local < clip.duration) {
          if (el.paused) {
            el.currentTime = local
            void el.play().catch(() => undefined)
          } else if (Math.abs(el.currentTime - local) > 0.25) {
            el.currentTime = local
          }
        } else if (!el.paused) {
          el.pause()
        }
      }
    }
    sync()
    return clock.subscribe(sync)
  }, [clock, clips, assets, muted])

  useEffect(() => {
    const els = elements.current
    return () => {
      for (const el of els.values()) {
        el.pause()
        el.removeAttribute('src')
      }
      els.clear()
    }
  }, [])
}
