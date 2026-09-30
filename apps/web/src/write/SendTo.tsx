import { cutTimeline, shotLabels } from '@weft/model'
import { useState } from 'react'
import { MediaFill } from '../board/Media'
import { attachToFrame } from '../lib/attach'
import { toast } from '../lib/toast'
import { useProject, useSnapshot } from '../project/hooks'
import { Input, Modal } from '../ui'
import { EntryAvatar, bibleOrder, entryName } from './bible-kinds'

/** Adds an asset to a frame's references or to a bible entry's pictures. */
export function SendTo({ assetId, cutId, onClose }: { assetId: string | null; cutId: string; onClose: () => void }) {
  const s = useSnapshot()
  const project = useProject()
  const [query, setQuery] = useState('')
  const labels = shotLabels(s)
  const q = query.trim().toLowerCase()
  const frames = cutTimeline(s, cutId)
    .items.map((i) => s.frames[i.frameId])
    .filter((f) => f !== undefined)
    .filter((f) => !q || f.description.toLowerCase().includes(q) || (labels.get(f.id) ?? '').toLowerCase() === q)
  const entries = Object.values(s.bible)
    .sort(bibleOrder)
    .filter((e) => !q || e.name.toLowerCase().includes(q))

  const send = (target: { frameId: string } | { entryId: string }) => {
    if (!assetId) return
    if ('frameId' in target) {
      attachToFrame(project, target.frameId, [assetId], 'references')
      toast(`Added to frame ${labels.get(target.frameId) ?? ''}'s references.`, 'ok')
    } else {
      project.addBibleAsset(target.entryId, assetId)
      toast(`Added to ${entryName(s.bible[target.entryId]!)}.`, 'ok')
    }
    onClose()
  }

  return (
    <Modal open={assetId !== null} onOpenChange={(open) => !open && onClose()} title="Send to…" description="Add this to a frame's references or to the bible." width={520}>
      <div className="flex flex-col gap-3">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search frames and the bible" aria-label="Search" />
        <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto">
          {entries.length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Bible</h3>
              {entries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => send({ entryId: e.id })}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <EntryAvatar entry={e} s={s} size={24} />
                  <span className="truncate text-fg">{entryName(e)}</span>
                </button>
              ))}
            </div>
          )}
          <div>
            <h3 className="mb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Frames in {s.cuts[cutId]?.name}</h3>
            {frames.map((f) => {
              const hero = f.media.find((m) => m.id === f.heroMediaId)
              const asset = hero ? s.assets[hero.assetId] : undefined
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => send({ frameId: f.id })}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span className="w-8 shrink-0 text-[11px] font-semibold text-accent-strong tabular-nums">{labels.get(f.id) ?? '—'}</span>
                  <span className="h-7 w-11 shrink-0 overflow-hidden rounded border border-line bg-media">
                    {asset && <MediaFill media={{ hash: asset.hash, kind: asset.kind }} />}
                  </span>
                  <span className="truncate text-fg-2">{f.description || 'No description'}</span>
                </button>
              )
            })}
            {frames.length === 0 && <p className="px-2 py-1.5 text-fg-3">No frames match.</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
