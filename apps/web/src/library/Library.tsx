import { assetUsage, formatDuration, notesUsage, type AssetKind, type AssetSnapshot, type Usage } from '@weft/model'
import { AudioLines, ExternalLink, Link2, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { revealOnBoard } from '../board/actions'
import { FolderLibrary } from '../spaces/FolderLibrary'
import { MediaFill } from '../board/Media'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { isAssetDrag, startAssetDrag } from '../lib/dnd'
import { addLink, singleUrl } from '../lib/links'
import { importFiles, mediaFiles, mediaUrl, useUploading } from '../lib/media'
import { navigate, projectPath, writePath } from '../lib/router'
import { usePref } from '../lib/prefs'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, Field, IconButton, Input, Modal, Segmented } from '../ui'
import { CommitInput, useFilePicker } from '../ui/inputs'
import { hostOf } from '../write/notes-nodes'

type Filter = 'all' | AssetKind | 'unused'

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Pictures' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'link', label: 'Links' },
  { id: 'unused', label: 'Unused' },
]

/** Where assets sit on notes pages, rescanned shortly after the notes change. */
function useNotesUsage(): ReadonlyMap<string, Usage[]> {
  const { project } = useProjectContext()
  const s = useSnapshot()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let timer = 0
    const onChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setVersion((v) => v + 1), 400)
    }
    project.pageContent.observeDeep(onChange)
    return () => {
      window.clearTimeout(timer)
      project.pageContent.unobserveDeep(onChange)
    }
  }, [project])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks notes changes
  return useMemo(() => notesUsage(project.pageContent, s.pages), [project, s.pages, version])
}

export function assetLabel(asset: AssetSnapshot): string {
  if (asset.kind === 'link') return asset.title && asset.title !== asset.url ? asset.title : hostOf(asset.url ?? '')
  return asset.title || asset.name || 'Untitled'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function AssetThumb({ asset }: { asset: AssetSnapshot }) {
  if (asset.kind === 'link') {
    return asset.preview ? (
      <img src={asset.preview} alt="" referrerPolicy="no-referrer" draggable={false} loading="lazy" className="size-full object-cover" />
    ) : (
      <div className="flex size-full flex-col items-center justify-center gap-1 text-fg-3">
        <Link2 size={16} aria-hidden />
        <span className="max-w-full truncate px-2 text-[10px]">{asset.site || hostOf(asset.url ?? '')}</span>
      </div>
    )
  }
  if (asset.kind === 'audio') {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 text-fg-3">
        <AudioLines size={18} aria-hidden />
        {asset.duration ? <span className="text-[10px] tabular-nums">{formatDuration(asset.duration)}</span> : null}
      </div>
    )
  }
  return <MediaFill media={{ hash: asset.hash, kind: asset.kind, title: asset.name }} size={320} />
}

/** Every image, video, audio file and link in the project. Drag them anywhere. */
export function Library({ onClose }: { onClose: () => void }) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [scope, setScope] = usePref('library-scope')
  const fromFolders = scope === 'folders'
  const usage = assetUsage(s)
  const notes = useNotesUsage()
  const uploading = useUploading()
  const usesOf = (id: string) => [...(usage.get(id) ?? []), ...(notes.get(id) ?? [])]

  const all = useMemo(() => Object.values(s.assets).sort((a, b) => b.createdAt - a.createdAt), [s.assets])
  const q = query.trim().toLowerCase()
  const shown = all.filter(
    (a) =>
      (filter === 'all' || (filter === 'unused' ? usesOf(a.id).length === 0 : a.kind === filter)) &&
      (!q || [a.name, a.title, a.site, a.url].some((t) => t?.toLowerCase().includes(q))),
  )
  const selected = selectedId ? s.assets[selectedId] : undefined

  const picker = useFilePicker((files) => void importFiles(project, files, user.id), 'image/*,video/*,audio/*')

  const onDragOver = (e: DragEvent) => {
    if (fromFolders || !e.dataTransfer.types.includes('Files') || isAssetDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDrop = (e: DragEvent) => {
    setDropping(false)
    const files = mediaFiles(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    void importFiles(project, files, user.id)
  }

  // Pasting while the Library has focus adds to the Library, not to the board or moodboard behind it.
  const onPaste = (e: ClipboardEvent) => {
    if (fromFolders || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return
    const files = mediaFiles(e.clipboardData)
    const url = files.length ? null : singleUrl(e.clipboardData.getData('text/plain'))
    if (!files.length && !url) return
    e.preventDefault()
    e.stopPropagation()
    if (files.length) void importFiles(project, files, user.id)
    else if (url) addLink(project, url, user.id)
  }

  return (
    <aside
      aria-label="Library"
      tabIndex={-1}
      className={cx('flex w-[300px] shrink-0 flex-col border-l border-line bg-panel focus:outline-none', dropping && 'ring-2 ring-accent ring-inset')}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={onDrop}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4">
        <h2 className="font-medium text-fg">Library</h2>
        {!fromFolders && <span className="ml-1 text-[12px] text-fg-3 tabular-nums">{all.length}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {!fromFolders && (
            <>
              <IconButton size="sm" label="Upload files" onClick={picker.open}>
                <Upload size={15} />
              </IconButton>
              <IconButton size="sm" label="Add a link" onClick={() => setLinkOpen(true)}>
                <Plus size={15} />
              </IconButton>
            </>
          )}
          <IconButton size="sm" label="Close the Library" tooltip="Close (L)" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
      </header>

      <div className="shrink-0 border-b border-line px-3 pt-3">
        <Segmented<'here' | 'folders'>
          label="Whose library"
          size="sm"
          options={[
            { id: 'here', label: 'This storyboard', title: 'Everything added to this storyboard' },
            { id: 'folders', label: 'Folders', title: 'Notes, pictures and clips kept in the folders this storyboard is in' },
          ]}
          value={fromFolders ? 'folders' : 'here'}
          onChange={(v) => setScope(v === 'folders' ? 'folders' : null)}
        />
        <div className="h-3" />
      </div>

      {fromFolders ? (
        <FolderLibrary />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search the Library" className="h-7 pl-8 text-[12px]" />
            </div>
            <Segmented<Filter> label="Show" size="sm" options={FILTERS} value={filter} onChange={(v) => setFilter(v ?? 'all')} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {shown.length ? (
              <div className="grid grid-cols-2 gap-2">
                {shown.map((asset) => {
                  const uses = usesOf(asset.id).length
                  const pending = !!asset.hash && uploading.has(asset.hash)
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      draggable
                      onDragStart={(e) => startAssetDrag(e, [asset.id])}
                      onClick={() => setSelectedId((id) => (id === asset.id ? null : asset.id))}
                      aria-pressed={asset.id === selectedId}
                      title={`${assetLabel(asset)}. Drag onto a frame, the moodboard, notes or the bible.`}
                      className={cx(
                        'flex cursor-grab flex-col overflow-hidden rounded-lg border bg-bg text-left active:cursor-grabbing',
                        asset.id === selectedId ? 'border-accent ring-2 ring-accent-soft' : 'border-line hover:border-line-strong',
                      )}
                    >
                      <span className="block aspect-[4/3] w-full overflow-hidden bg-media">
                        <AssetThumb asset={asset} />
                      </span>
                      <span className="block px-2 py-1.5">
                        <span className="block truncate text-[12px] text-fg">{assetLabel(asset)}</span>
                        <span className={cx('block text-[11px]', uses || pending ? 'text-fg-3' : 'text-warn')}>
                          {pending ? 'Uploading…' : uses ? `Used ${uses === 1 ? 'once' : `${uses} times`}` : 'Unused'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-fg-3">
                <p>
                  {all.length
                    ? 'Nothing matches.'
                    : 'Everything you add anywhere in the project lands here. Drop or paste files on this panel to add them.'}
                </p>
                {!all.length && (
                  <Button size="sm" icon={<Upload size={14} />} onClick={picker.open}>
                    Upload files
                  </Button>
                )}
              </div>
            )}
          </div>

          {selected && <Details asset={selected} uses={usesOf(selected.id)} onClose={() => setSelectedId(null)} />}
        </>
      )}
      {picker.input}
      <AddLinkDialog open={linkOpen} onOpenChange={setLinkOpen} />
    </aside>
  )
}

function Details({ asset, uses, onClose }: { asset: AssetSnapshot; uses: Usage[]; onClose: () => void }) {
  const project = useProject()
  const { projectId } = useProjectContext()
  const [confirming, setConfirming] = useState(false)
  const href = asset.kind === 'link' ? (asset.url ?? '') : asset.hash ? mediaUrl(asset.hash) : ''
  const facts = [
    asset.kind === 'link' ? asset.site || hostOf(href) : null,
    asset.width && asset.height ? `${asset.width} × ${asset.height}` : null,
    asset.duration ? formatDuration(asset.duration) : null,
    asset.size ? formatBytes(asset.size) : null,
  ].filter(Boolean)

  const open = (u: Usage) => {
    if (u.frameId) {
      revealOnBoard(u.frameId)
      navigate(projectPath(projectId, 'board'))
    } else if (u.kind === 'bible' || u.kind === 'style') navigate(writePath(projectId, { section: 'bible', pageId: null }))
    else if (u.kind === 'moodboard') navigate(writePath(projectId, { section: 'moodboard', pageId: null }))
    else if (u.kind === 'notes' && u.pageId) navigate(writePath(projectId, { section: 'notes', pageId: u.pageId }))
    else if (u.kind === 'music') navigate(projectPath(projectId, 'play'))
  }
  const where = uses.filter((u, i) => uses.findIndex((v) => v.kind === u.kind && v.label === u.label) === i)

  return (
    <section aria-label="Asset details" className="max-h-[48%] shrink-0 overflow-y-auto border-t border-line p-3">
      <div className="mb-2 flex items-center gap-1">
        <CommitInput
          aria-label="Name"
          value={asset.kind === 'link' ? asset.title : asset.name}
          placeholder={asset.kind === 'link' ? hostOf(href) : 'Name'}
          onCommit={(v) => project.updateAsset(asset.id, asset.kind === 'link' ? { title: v.trim() } : { name: v.trim() })}
          className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-[13px] font-medium hover:border-line"
        />
        <IconButton size="sm" label="Close details" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {facts.length > 0 && <p className="mb-2 px-1.5 text-[11px] text-fg-3">{facts.join(' · ')}</p>}
      <div className="mb-3 flex flex-col gap-0.5">
        <h3 className="px-1.5 text-[11px] font-medium tracking-wide text-fg-3 uppercase">{where.length ? 'Used in' : 'Not used yet'}</h3>
        {where.map((u, i) => (
          <button
            key={i}
            type="button"
            onClick={() => open(u)}
            className="flex h-7 items-center rounded-md px-1.5 text-left text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            <span className="truncate">
              {u.label}
              {u.kind === 'frame-reference' && ' (reference)'}
              {u.kind === 'vo' && ' (VO recording)'}
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {href && (
          <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>
            Open
          </Button>
        )}
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => (uses.length ? setConfirming(true) : project.deleteAsset(asset.id))}>
          Delete
        </Button>
      </div>
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete “${assetLabel(asset)}”?`}
        description={`It's used in ${uses.length} ${uses.length === 1 ? 'place' : 'places'} and will be removed from ${uses.length === 1 ? 'it' : 'them'}. Notes pages keep showing their copy.`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => {
              setConfirming(false)
              onClose()
              project.deleteAsset(asset.id)
            }}
          >
            Delete everywhere
          </Button>
        </div>
      </Modal>
    </section>
  )
}

function AddLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const project = useProject()
  const user = useUser()
  const [url, setUrl] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    addLink(project, /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`, user.id)
    setUrl('')
    onOpenChange(false)
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add a link to the Library">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Web address" htmlFor="library-link">
          <Input id="library-link" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!url.trim()}>
            Add link
          </Button>
        </div>
      </form>
    </Modal>
  )
}
