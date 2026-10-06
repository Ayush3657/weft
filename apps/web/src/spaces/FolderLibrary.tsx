import { assetUsage, notesUsage, type Project } from '@weft/model'
import { ExternalLink, NotebookText, Plus, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { api, type LibraryItem, type LibraryLevel } from '../lib/api'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { startAssetDrag } from '../lib/dnd'
import { navigate, spacePath } from '../lib/router'
import { toast } from '../lib/toast'
import { useProject } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Input, Modal, Spinner } from '../ui'
import { LibraryThumb, matches } from './LibraryView'

/** The last libraries shown for each project. */
const cache = new Map<string, LibraryLevel[]>()

/** The project's own asset for a library item: the one it already has, or a new one. */
function assetFor(project: Project, item: LibraryItem, userId: string): { assetId: string; created: boolean } {
  const existing = [...project.assets.values()].find((m) => m.get('hash') === item.hash)
  if (existing) return { assetId: String(existing.get('id')), created: false }
  const assetId = project.addAsset({
    kind: item.kind,
    hash: item.hash,
    name: item.name,
    mime: item.mime,
    size: item.size,
    width: item.width,
    height: item.height,
    duration: item.duration,
    createdBy: userId,
  })
  return { assetId, created: true }
}

/**
 * What this storyboard can draw on from its folders: their notes, and
 * pictures and clips to drag onto frames, the moodboard, notes or the bible.
 */
export function FolderLibrary() {
  const project = useProject()
  const { projectId } = useProjectContext()
  const user = useUser()
  const [levels, setLevels] = useState<LibraryLevel[] | null>(cache.get(projectId) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [notes, setNotes] = useState<LibraryLevel | null>(null)

  const load = useCallback(
    () =>
      api<{ levels: LibraryLevel[] }>(`/api/projects/${projectId}/library`).then(
        ({ levels: next }) => {
          cache.set(projectId, next)
          setLevels(next)
          setError(null)
        },
        (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the folder libraries"),
      ),
    [projectId],
  )
  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const level of levels ?? []) for (const item of level.items) for (const t of item.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [levels])

  if (!levels) return <div className="p-4">{error ? <p className="text-fg-2">{error}</p> : <Spinner />}</div>

  const take = (item: LibraryItem) => {
    const { created } = assetFor(project, item, user.id)
    toast(created ? `Added “${item.name}” to this storyboard's Library.` : `“${item.name}” is already in this storyboard.`, 'ok')
  }

  const onDragStart = (e: DragEvent, item: LibraryItem) => {
    const { assetId, created } = assetFor(project, item, user.id)
    startAssetDrag(e, [assetId])
    if (!created) return
    // A drag that lands nowhere shouldn't leave the picture behind in this storyboard.
    const cleanUp = () =>
      window.setTimeout(() => {
        const s = project.snapshot()
        const used = (assetUsage(s).get(assetId)?.length ?? 0) + (notesUsage(project.pageContent, s.pages).get(assetId)?.length ?? 0)
        if (!used) project.deleteAsset(assetId)
      }, 400)
    e.currentTarget.addEventListener('dragend', cleanUp, { once: true })
  }

  const total = levels.reduce((n, l) => n + l.items.length, 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search folders" aria-label="Search the folder libraries" className="h-7 pl-8 text-[12px]" />
        </div>
        {tags.length > 0 && (
          <div className="flex max-h-[68px] flex-wrap gap-1 overflow-y-auto" role="group" aria-label="Filter by tag">
            {tags.map(([t, n]) => (
              <button
                key={t}
                type="button"
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
                className={cx('h-5 rounded-full border px-2 text-[11px]', tag === t ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:text-fg')}
              >
                {t} <span className="text-fg-3">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {levels.map((level, i) => {
          const shown = level.items.filter((item) => (!tag || item.tags.includes(tag)) && matches(item, query))
          return (
            <section key={`${level.spaceId}/${level.folderId ?? ''}`} className="mb-4">
              <header className="mb-1.5 flex items-center gap-1">
                <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg" title={i === 0 ? 'This storyboard’s space' : 'A folder it’s in'}>
                  {level.name}
                </h3>
                {level.about.trim() && (
                  <button type="button" onClick={() => setNotes(level)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-2 hover:bg-hover hover:text-fg">
                    <NotebookText size={12} aria-hidden /> Notes
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Open the library of ${level.name}`}
                  title="Open this library"
                  onClick={() => navigate(spacePath(level.spaceId, level.folderId, 'library'))}
                  className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg"
                >
                  <ExternalLink size={12} />
                </button>
              </header>
              {shown.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {shown.map((item) => (
                    <div key={item.id} className="group relative">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => onDragStart(e, item)}
                        onDoubleClick={() => take(item)}
                        title={`${item.name}${item.caption ? `: ${item.caption}` : ''}. Drag onto a frame, the moodboard, notes or the bible.`}
                        className="flex w-full cursor-grab flex-col overflow-hidden rounded-lg border border-line bg-bg text-left hover:border-line-strong active:cursor-grabbing"
                      >
                        <span className="block aspect-[4/3] w-full overflow-hidden bg-media">
                          <LibraryThumb item={item} />
                        </span>
                        <span className="block px-2 py-1">
                          <span className="block truncate text-[11px] text-fg">{item.name}</span>
                          <span className="block truncate text-[10px] text-fg-3">
                            {item.tags.join(', ') || (item.suggestedTags.length ? '' : 'No tags')}
                            {item.suggestedTags.length > 0 && (
                              <span className="ml-1 inline-flex items-center gap-0.5 text-accent-strong">
                                <Sparkles size={9} aria-hidden />
                                {item.suggestedTags.length}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Add ${item.name} to this storyboard`}
                        title="Add to this storyboard's Library"
                        onClick={() => take(item)}
                        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-fg-3">{level.items.length ? 'Nothing matches here.' : 'No pictures or clips here yet.'}</p>
              )}
            </section>
          )
        })}
        {total === 0 && !levels.some((l) => l.about.trim()) && (
          <p className="text-[12px] text-fg-3">
            Put this storyboard in a folder and fill the folder's Library with renders and notes; they show up here for every storyboard inside.
          </p>
        )}
      </div>
      <Modal open={notes !== null} onOpenChange={(open) => !open && setNotes(null)} width={560} title={notes ? `About ${notes.name}` : ''}>
        <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-fg-2">{notes?.about}</p>
      </Modal>
    </div>
  )
}
