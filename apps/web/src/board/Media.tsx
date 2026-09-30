import type { AssetKind } from '@weft/model'
import { AudioLines, Film, ImagePlus, Link2 } from 'lucide-react'
import { cx } from '../lib/cx'
import { mediaUrl } from '../lib/media'

export interface MediaRef {
  hash: string | null
  kind: AssetKind
  title?: string
}

/** An image or video filling its box. Videos play on hover. */
export function MediaFill({ media, className, controls = false }: { media: MediaRef; className?: string; controls?: boolean }) {
  if (!media.hash) return <MediaIcon kind={media.kind} className={className} />
  const src = mediaUrl(media.hash)
  if (media.kind === 'video') {
    return (
      <video
        src={src}
        muted={!controls}
        controls={controls}
        playsInline
        loop={!controls}
        preload="metadata"
        className={cx('size-full object-cover', className)}
        onMouseEnter={controls ? undefined : (e) => void e.currentTarget.play().catch(() => undefined)}
        onMouseLeave={controls ? undefined : (e) => e.currentTarget.pause()}
      />
    )
  }
  if (media.kind === 'image') {
    return (
      <img
        src={src}
        alt={media.title ?? ''}
        draggable={false}
        loading="lazy"
        decoding="async"
        className={cx('size-full object-cover', className)}
      />
    )
  }
  return <MediaIcon kind={media.kind} className={className} />
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
