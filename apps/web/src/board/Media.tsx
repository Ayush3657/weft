import type { AssetKind } from '@weft/model'
import { AudioLines, Film, ImagePlus, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { displayUrl } from '../lib/media'

export interface MediaRef {
  hash: string | null
  kind: AssetKind
  title?: string
}

/**
 * The address to show a file from. A file someone else just added can still
 * be on its way to the server, so a failed load is retried for a little while.
 */
export function useMediaSrc(hash: string | null): { src: string | null; onError: () => void } {
  const [attempt, setAttempt] = useState({ hash, count: 0 })
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const count = attempt.hash === hash ? attempt.count : 0
  if (!hash) return { src: null, onError: () => undefined }
  const base = displayUrl(hash)
  return {
    src: count && !base.startsWith('blob:') ? `${base}?try=${count}` : base,
    onError: () => {
      // About a minute of tries: quick at first, then every two seconds.
      if (count >= 30) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setAttempt({ hash, count: count + 1 }), Math.min(2000, 500 * (count + 1)))
    },
  }
}

/** An image or video filling its box. Videos play on hover. */
export function MediaFill({ media, className, controls = false }: { media: MediaRef; className?: string; controls?: boolean }) {
  const { src, onError } = useMediaSrc(media.kind === 'image' || media.kind === 'video' ? media.hash : null)
  if (!src) return <MediaIcon kind={media.kind} className={className} />
  if (media.kind === 'video') {
    return (
      <video
        src={src}
        muted={!controls}
        controls={controls}
        playsInline
        loop={!controls}
        preload="metadata"
        onError={onError}
        className={cx('size-full object-cover', className)}
        onMouseEnter={controls ? undefined : (e) => void e.currentTarget.play().catch(() => undefined)}
        onMouseLeave={controls ? undefined : (e) => e.currentTarget.pause()}
      />
    )
  }
  return (
    <img
      src={src}
      alt={media.title ?? ''}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={onError}
      className={cx('size-full object-cover', className)}
    />
  )
}

export function MediaIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  const Icon = kind === 'video' ? Film : kind === 'audio' ? AudioLines : kind === 'link' ? Link2 : ImagePlus
  return (
    <div className={cx('flex size-full items-center justify-center text-fg-3', className)}>
      <Icon size={16} aria-hidden />
    </div>
  )
}

export function EmptyMedia({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1.5 text-fg-3">
      <ImagePlus size={compact ? 16 : 20} strokeWidth={1.6} aria-hidden />
      {!compact && <span className="text-[11px]">Drop an image or video</span>}
    </div>
  )
}
