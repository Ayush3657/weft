import { formatDuration } from '@weft/model'
import { AudioLines, Check, ExternalLink, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { MediaFill } from '../board/Media'
import { api, type FolderInfo, type LibraryItem, type LibraryLevel } from '../lib/api'
import { cx } from '../lib/cx'
import { mediaFiles, mediaUrl, prepareFile } from '../lib/media'
import { toastError } from '../lib/toast'
import { Button, IconButton, Input, Segmented, Select, Spinner, textareaClass } from '../ui'
import { CommitInput, useFilePicker } from '../ui/inputs'
import { ancestors } from './store'

type Kind = 'all' | LibraryItem['kind']

/** The last library shown for each place, so coming back shows it at once. */
const cache = new Map<string, LibraryLevel>()

const placeKey = (spaceId: string, folderId: string | null) => `${spaceId}/${folderId ?? ''}`

export function libraryUrl(spaceId: string, folderId: string | null): string {
  return folderId ? `/api/library?folder=${folderId}` : `/api/library?space=${spaceId}`
}

/** Tags in use, most used first. */
function tagCounts(items: readonly LibraryItem[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function matches(item: LibraryItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = `${item.name} ${item.caption} ${item.tags.join(' ')}`.toLowerCase()
  return words.every((w) => text.includes(w))
}

export function LibraryThumb({ item, size = 320 }: { item: LibraryItem; size?: 320 | 640 }) {
  if (item.kind === 'audio') {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 text-fg-3">
        <AudioLines size={18} aria-hidden />
        {item.duration ? <span className="text-[10px] tabular-nums">{formatDuration(item.duration)}</span> : null}
      </div>
    )
  }
  return <MediaFill media={{ hash: item.hash, kind: item.kind, title: item.name }} size={size} />
}

/**
 * A space's or folder's library: notes on what its storyboards are about, and
 * the pictures, clips and sound the team (and Claude) can use, with tags.
 */
export function LibraryView({ spaceId, folderId, name, folders }: { spaceId: string; folderId: string | null; name: string; folders: readonly FolderInfo[] }) {
  const key = placeKey(spaceId, folderId)
  const [level, setLevel] = useState<LibraryLevel | null>(cache.get(key) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<Array<{ key: number; name: string; hash: string | null }>>([])
  const [dropping, setDropping] = useState(false)
  const counter = useRef(0)

  const keep = useCallback(
    (next: LibraryLevel) => {
      cache.set(key, next)
      setLevel(next)
    },
    [key],
  )
  const load = useCallback(
    () =>
      api<LibraryLevel>(libraryUrl(spaceId, folderId)).then(
        (next) => {
          keep(next)
          setError(null)
        },
        (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the library"),
      ),
    [spaceId, folderId, keep],
  )

  useEffect(() => {
    setLevel(cache.get(key) ?? null)
    setSelectedId(null)
    setTag(null)
    setQuery('')
    void load()
  }, [key, load])

  const replace = (item: LibraryItem) => level && keep({ ...level, items: level.items.map((i) => (i.id === item.id ? item : i)) })

  const addFiles = async (files: File[]) => {
    for (const file of files) {
      const slot = { key: ++counter.current, name: file.name, hash: null as string | null }
      setPending((p) => [...p, slot])
      try {
        const prepared = await prepareFile(file)
        setPending((p) => p.map((x) => (x.key === slot.key ? { ...x, hash: prepared.hash } : x)))
        await prepared.uploaded
        await api('/api/library', {
          method: 'POST',
          body: {
            spaceId,
            folderId,
            hash: prepared.hash,
            name: prepared.name,
            mime: file.type,
            width: prepared.meta.width || null,
            height: prepared.meta.height || null,
            duration: prepared.meta.duration || null,
          },
        })
        await load()
      } catch (e) {
        toastError(e)
      } finally {
        setPending((p) => p.filter((x) => x.key !== slot.key))
      }
    }
  }

  const picker = useFilePicker((files) => void addFiles(files), 'image/*,video/*,audio/*')

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDrop = (e: DragEvent) => {
    setDropping(false)
    const files = mediaFiles(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }
  const onPaste = (e: ClipboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
    const files = mediaFiles(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }

  const items = level?.items ?? []
  const tags = useMemo(() => tagCounts(items), [items])
  const shown = items.filter((i) => (kind === 'all' || i.kind === kind) && (!tag || i.tags.includes(tag)) && matches(i, query))
  const selected = items.find((i) => i.id === selectedId) ?? null
  const suggestions = items.reduce((n, i) => n + i.suggestedTags.length, 0)

  if (!level) {
    return <div className="py-10">{error ? <p className="text-fg-2">{error}</p> : <Spinner label="Loading the library…" />}</div>
  }

  return (
    <div className="flex gap-6 pt-5" onPaste={onPaste} tabIndex={-1}>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <AboutEditor
          key={key}
          value={level.about}
          name={name}
          onSave={async (about) => {
            await api(folderId ? `/api/folders/${folderId}` : `/api/spaces/${spaceId}`, { method: 'PATCH', body: { about } })
            keep({ ...level, about })
          }}
        />

        <section
          aria-label="Pictures, clips and sound"
          onDragOver={onDragOver}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
          onDrop={onDrop}
          className={cx('flex flex-col gap-3 rounded-xl', dropping && 'ring-2 ring-accent ring-offset-4 ring-offset-canvas')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-1 text-[14px] font-semibold text-fg">
              Media <span className="font-normal text-fg-3 tabular-nums">{items.length || ''}</span>
            </h3>
            {suggestions > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-strong">
                <Sparkles size={11} aria-hidden /> {suggestions} suggested {suggestions === 1 ? 'tag' : 'tags'} to review
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search the library" className="h-7 w-44 pl-8 text-[12px]" />
              </div>
              <Segmented<Kind>
                label="Show"
                size="sm"
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'image', label: 'Pictures' },
                  { id: 'video', label: 'Video' },
                  { id: 'audio', label: 'Sound' },
                ]}
                value={kind}
                onChange={(v) => setKind(v ?? 'all')}
              />
              <Button size="sm" icon={<Upload size={14} />} onClick={picker.open}>
                Add files
              </Button>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
              {tags.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={cx(
                    'h-6 rounded-full border px-2.5 text-[12px] transition-colors',
                    tag === t ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg',
                  )}
                >
                  {t} <span className="text-fg-3 tabular-nums">{n}</span>
                </button>
              ))}
            </div>
          )}

          {shown.length || pending.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
              {pending.map((p) => (
                <li key={`pending-${p.key}`} className="flex flex-col overflow-hidden rounded-lg border border-dashed border-line-strong bg-bg">
                  <span className="block aspect-[4/3] w-full overflow-hidden bg-media opacity-70">
                    {p.hash ? <MediaFill media={{ hash: p.hash, kind: 'image' }} size={320} /> : null}
                  </span>
                  <span className="block truncate px-2 py-1.5 text-[12px] text-fg-3">Adding {p.name}…</span>
                </li>
              ))}
              {shown.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                    aria-pressed={item.id === selectedId}
                    className={cx(
                      'flex w-full flex-col overflow-hidden rounded-lg border bg-bg text-left',
                      item.id === selectedId ? 'border-accent ring-2 ring-accent-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="block aspect-[4/3] w-full overflow-hidden bg-media">
                      <LibraryThumb item={item} />
                    </span>
                    <span className="flex flex-col gap-1 px-2 py-1.5">
                      <span className="truncate text-[12px] text-fg">{item.name}</span>
                      <span className="flex min-h-[18px] flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded bg-hover px-1.5 text-[11px] leading-[18px] text-fg-2">
                            {t}
                          </span>
                        ))}
                        {item.tags.length > 3 && <span className="text-[11px] leading-[18px] text-fg-3">+{item.tags.length - 3}</span>}
                        {item.suggestedTags.length > 0 && (
                          <span className="flex items-center gap-0.5 rounded bg-accent-soft px-1.5 text-[11px] leading-[18px] text-accent-strong">
                            <Sparkles size={10} aria-hidden /> {item.suggestedTags.length}
                          </span>
                        )}
                        {!item.tags.length && !item.suggestedTags.length && <span className="text-[11px] leading-[18px] text-warn">No tags</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
              <p className="max-w-md text-fg-2">
                {items.length
                  ? 'Nothing matches.'
                  : `Drop renders, walkthroughs, drone shots, floor plans and logos for ${name} here, or paste them. Tag them so the team and Claude can find them.`}
              </p>
              {!items.length && (
                <Button size="sm" icon={<Upload size={14} />} onClick={picker.open}>
                  Add files
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      {selected && (
        <ItemDetails
          key={selected.id}
          item={selected}
          known={tags.map(([t]) => t)}
          folders={folders}
          onChange={replace}
          onRemoved={() => {
            keep({ ...level, items: level.items.filter((i) => i.id !== selected.id) })
            setSelectedId(null)
          }}
          onMoved={() => {
            setSelectedId(null)
            void load()
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
      {picker.input}
    </div>
  )
}

/** The notes for a space or folder, saved as you type. */
function AboutEditor({ value, name, onSave }: { value: string; name: string; onSave: (about: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const focused = useRef(false)
  const timer = useRef(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(120, el.scrollHeight + 2)}px`
  }, [draft])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = async (text: string) => {
    window.clearTimeout(timer.current)
    if (text === value) {
      setState('saved')
      return
    }
    setState('saving')
    try {
      await onSave(text)
      setState('saved')
    } catch (error) {
      setState('unsaved')
      toastError(error)
    }
  }

  return (
    <section aria-label={`About ${name}`} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold text-fg">About {name}</h3>
        <span className="text-[11px] text-fg-3">{state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Not saved' : 'Claude reads this'}</span>
      </div>
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          setState('unsaved')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => void save(text), 1200)
        }}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          void save(draft)
        }}
        placeholder={`What the team and Claude should know about ${name}: where it is, configurations and sizes, highlights and amenities, the tone, and lines every ad must include (the RERA number, a disclaimer).`}
        className={cx(textareaClass, 'min-h-[120px] resize-none text-[13px] leading-[1.55]')}
      />
    </section>
  )
}

/** One item: bigger, with its name, caption, tags and Claude's suggested tags. */
function ItemDetails({
  item,
  known,
  folders,
  onChange,
  onRemoved,
  onMoved,
  onClose,
}: {
  item: LibraryItem
  known: readonly string[]
  folders: readonly FolderInfo[]
  onChange: (item: LibraryItem) => void
  onRemoved: () => void
  onMoved: () => void
  onClose: () => void
}) {
  const patch = async (body: Record<string, unknown>) => {
    try {
      const { item: next } = await api<{ item: LibraryItem }>(`/api/library/${item.id}`, { method: 'PATCH', body })
      onChange(next)
      return next
    } catch (error) {
      toastError(error)
      return null
    }
  }
  const facts = [
    item.width && item.height ? `${item.width} × ${item.height}` : null,
    item.duration ? formatDuration(item.duration) : null,
    item.addedBy ? `added by ${item.addedBy.name}` : null,
    new Date(item.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  ].filter(Boolean)
  const paths = folders.map((f) => ({ id: f.id, label: ancestors(folders, f.id).map((a) => a.name).join(' › ') })).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <aside aria-label="Library item" className="sticky top-4 flex max-h-[calc(100vh-140px)] w-[320px] shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center gap-1">
        <CommitInput
          aria-label="Name"
          value={item.name}
          onCommit={(name) => void patch({ name })}
          className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-[13px] font-medium hover:border-line"
        />
        <IconButton size="sm" label="Close" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="overflow-hidden rounded-lg bg-media">
        {item.kind === 'video' ? (
          <video src={mediaUrl(item.hash)} controls muted playsInline preload="metadata" className="aspect-video w-full object-contain" />
        ) : item.kind === 'audio' ? (
          <audio src={mediaUrl(item.hash)} controls className="w-full" />
        ) : (
          <div className="aspect-[4/3] w-full">
            <LibraryThumb item={item} size={640} />
          </div>
        )}
      </div>
      {facts.length > 0 && <p className="px-1 text-[11px] text-fg-3">{facts.join(' · ')}</p>}

      <label className="flex flex-col gap-1">
        <span className="px-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">What it shows</span>
        <CaptionInput value={item.caption} onCommit={(caption) => void patch({ caption })} />
      </label>

      <div className="flex flex-col gap-1">
        <span className="px-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Tags</span>
        <TagEditor tags={item.tags} known={known} onChange={(tags) => void patch({ tags })} />
      </div>

      {item.suggestedTags.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-accent-soft p-2">
          <span className="flex items-center gap-1 text-[12px] font-medium text-fg">
            <Sparkles size={12} aria-hidden /> Claude suggests
          </span>
          <div className="flex flex-wrap gap-1">
            {item.suggestedTags.map((t) => (
              <span key={t} className="flex items-center gap-0.5 rounded border border-dashed border-accent/60 bg-panel pl-1.5 text-[12px] text-fg">
                {t}
                <button type="button" aria-label={`Keep ${t}`} title="Keep" onClick={() => void patch({ accept: [t] })} className="rounded p-0.5 text-ok hover:bg-hover">
                  <Check size={12} />
                </button>
                <button type="button" aria-label={`Drop ${t}`} title="Drop" onClick={() => void patch({ reject: [t] })} className="rounded p-0.5 text-fg-3 hover:bg-hover hover:text-fg">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void patch({ accept: item.suggestedTags })}>
              Keep all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void patch({ reject: item.suggestedTags })}>
              Drop all
            </Button>
          </div>
        </div>
      )}

      {folders.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="px-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Kept in</span>
          <Select
            value={item.folderId ?? ''}
            onChange={(e) => void patch({ folderId: e.target.value || null }).then((next) => next && onMoved())}
            className="h-8 text-[12px]"
          >
            <option value="">The space's own library</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(mediaUrl(item.hash), '_blank', 'noopener,noreferrer')}>
          Open
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={async () => {
            try {
              await api(`/api/library/${item.id}`, { method: 'DELETE' })
              onRemoved()
            } catch (error) {
              toastError(error)
            }
          }}
        >
          Remove
        </Button>
      </div>
      <p className="px-1 text-[11px] text-fg-3">Removing it keeps it in any storyboard that already uses it.</p>
    </aside>
  )
}

function CaptionInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <textarea
      value={draft}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      placeholder="What's in it, in a sentence"
      className={cx(textareaClass, 'resize-none text-[12px]')}
    />
  )
}

/** Tags as chips: type and press Enter (or a comma) to add, Backspace to take the last off. */
function TagEditor({ tags, known, onChange }: { tags: readonly string[]; known: readonly string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const fresh = raw
      .split(',')
      .map((t) => t.replace(/^#/, '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((t) => t && !tags.includes(t))
    setDraft('')
    if (fresh.length) onChange([...tags, ...new Set(fresh)])
  }
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg p-1.5 focus-within:border-accent">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded bg-hover pl-1.5 text-[12px] text-fg">
          {t}
          <button type="button" aria-label={`Remove the tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="rounded p-0.5 text-fg-3 hover:text-fg">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        aria-label="Add a tag"
        list="library-tag-list"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={tags.length ? 'Add a tag' : 'aerial, clubhouse, dusk…'}
        className="h-6 min-w-[90px] flex-1 bg-transparent px-1 text-[12px] text-fg outline-none placeholder:text-fg-3"
      />
      <datalist id="library-tag-list">
        {known
          .filter((t) => !tags.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  )
}
