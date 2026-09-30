import type { BibleEntrySnapshot, BibleKind, ProjectSnapshot } from '@weft/model'
import { MapPin, Package, UserRound, type LucideProps } from 'lucide-react'
import { MediaFill } from '../board/Media'
import { cx } from '../lib/cx'

export const BIBLE_KIND_INFO: Record<BibleKind, { label: string; plural: string; hint: string }> = {
  character: { label: 'Character', plural: 'Cast', hint: 'People and voices: who they are, how they look and sound.' },
  location: { label: 'Location', plural: 'Locations', hint: 'Places and sets: time of day, mood, what must be seen.' },
  product: { label: 'Product', plural: 'Products', hint: 'What the ad sells: packshots, logos, colours, must-shows.' },
}

const ORDER: Record<BibleKind, number> = { character: 0, location: 1, product: 2 }

export function bibleOrder(a: BibleEntrySnapshot, b: BibleEntrySnapshot): number {
  return ORDER[a.kind] - ORDER[b.kind] || a.createdAt - b.createdAt
}

export function BibleIcon({ kind, ...props }: { kind: BibleKind } & LucideProps) {
  const Icon = kind === 'character' ? UserRound : kind === 'location' ? MapPin : Package
  return <Icon aria-hidden {...props} />
}

/** The entry's first picture, or its kind's icon. */
export function EntryAvatar({ entry, s, size = 20 }: { entry: BibleEntrySnapshot; s: ProjectSnapshot; size?: number }) {
  const picture = entry.assetIds.map((id) => s.assets[id]).find((a) => a && (a.kind === 'image' || a.kind === 'video'))
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center overflow-hidden bg-hover text-fg-2',
        entry.kind === 'character' ? 'rounded-full' : 'rounded-[5px]',
      )}
      style={{ width: size, height: size }}
    >
      {picture ? (
        <MediaFill media={{ hash: picture.hash, kind: picture.kind }} />
      ) : (
        <BibleIcon kind={entry.kind} size={Math.round(size * 0.6)} />
      )}
    </span>
  )
}

export function entryName(entry: BibleEntrySnapshot): string {
  return entry.name.trim() || `Unnamed ${BIBLE_KIND_INFO[entry.kind].label.toLowerCase()}`
}
