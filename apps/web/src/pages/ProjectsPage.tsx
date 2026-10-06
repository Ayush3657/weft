import { ASPECT_RATIOS, PROJECT_DEFAULTS, type AspectRatio, type ProjectType } from '@weft/model'
import {
  ArrowDownUp,
  ChevronRight,
  Clapperboard,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type FolderInfo, type ProjectSummary, type SpaceContents, type SpaceSummary } from '../lib/api'
import { cx } from '../lib/cx'
import { usePref } from '../lib/prefs'
import { navigate, projectPath, spacePath, type ProjectsLocation } from '../lib/router'
import { toast, toastError } from '../lib/toast'
import { AppHeader } from '../shell/Shell'
import { ConfirmDialog, MembersDialog, MoveDialog, NameDialog } from '../spaces/Dialogs'
import { startMoveDrag, useMoveTarget, type Dragged } from '../spaces/dnd'
import { LibraryView } from '../spaces/LibraryView'
import { Sidebar, folderMenu, spaceMenu, type PlaceActions } from '../spaces/Sidebar'
import {
  ancestors,
  childrenOf,
  countIn,
  createFolder,
  createSpace,
  deleteFolder,
  deleteProject,
  deleteSpace,
  moveProject,
  refreshContents,
  refreshSpaces,
  updateFolder,
  updateSpace,
  useContents,
  useSpaces,
  within,
} from '../spaces/store'
import { Button, Field, IconButton, Input, Menu, Modal, Segmented, Spinner } from '../ui'
import { OpenFolderButton, VaultPanel } from '../vault/VaultPanel'

const TYPE_LABELS: Record<ProjectType, string> = { ad: 'Ad', film: 'Short film', other: 'Other' }
const TYPE_ICONS = { ad: Sparkles, film: Film, other: Clapperboard }

type Place = { spaceId: string; folderId: string | null }

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

type SortKey = 'edited' | 'name' | 'created' | 'type'
const SORTS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'edited', label: 'Last edited' },
  { id: 'name', label: 'Name' },
  { id: 'created', label: 'Newest first' },
  { id: 'type', label: 'Type' },
]

function sorted(projects: readonly ProjectSummary[], key: SortKey): ProjectSummary[] {
  const byName = (a: ProjectSummary, b: ProjectSummary) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  const list = [...projects]
  if (key === 'name') return list.sort(byName)
  if (key === 'created') return list.sort((a, b) => b.createdAt - a.createdAt)
  if (key === 'type') return list.sort((a, b) => a.type.localeCompare(b.type) || b.updatedAt - a.updatedAt)
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

type Dialog =
  | { kind: 'new-space' }
  | { kind: 'rename-space'; space: SpaceSummary }
  | { kind: 'delete-space'; space: SpaceSummary }
  | { kind: 'members'; space: SpaceSummary }
  | { kind: 'new-folder'; spaceId: string; parentId: string | null }
  | { kind: 'rename-folder'; folder: FolderInfo }
  | { kind: 'move-folder'; folder: FolderInfo }
  | { kind: 'delete-folder'; folder: FolderInfo }
  | { kind: 'new-storyboard' }
  | { kind: 'move-project'; project: ProjectSummary }
  | { kind: 'delete-project'; project: ProjectSummary }
  | { kind: 'vault' }

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')

/** Your spaces and their folders, storyboards and libraries. */
export function ProjectsPage({ location }: { location: ProjectsLocation }) {
  const { spaceId, folderId, tab } = location
  const spaces = useSpaces()
  const contents = useContents(spaceId)
  const [lastPlace, setLastPlace] = usePref('projects-place')
  const [spacesError, setSpacesError] = useState<string | null>(null)
  const [contentsError, setContentsError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = (open: boolean) => !open && setDialog(null)

  const loadSpaces = () => void refreshSpaces().then(() => setSpacesError(null), (e: unknown) => setSpacesError(messageOf(e)))
  useEffect(loadSpaces, [])

  // The bare address opens where you were last, or else your first team space.
  useEffect(() => {
    if (spaceId || !spaces) return
    const [lastSpace = '', lastFolder = ''] = (lastPlace ?? '').split('/')
    const last = spaces.find((s) => s.id === lastSpace)
    const target = last ?? spaces.find((s) => s.kind === 'team') ?? spaces[0]
    if (target) navigate(spacePath(target.id, last ? lastFolder || null : null), { replace: true })
  }, [spaceId, spaces, lastPlace])

  useEffect(() => {
    if (spaceId) setLastPlace(`${spaceId}/${folderId ?? ''}`)
  }, [spaceId, folderId, setLastPlace])

  useEffect(() => {
    if (!spaceId) return
    let stale = false
    setContentsError(null)
    refreshContents(spaceId).catch((e: unknown) => !stale && setContentsError(messageOf(e)))
    return () => {
      stale = true
    }
  }, [spaceId])

  // Back from a storyboard in another tab: show what changed meanwhile.
  useEffect(() => {
    const onFocus = () => {
      void refreshSpaces().catch(() => undefined)
      if (spaceId) void refreshContents(spaceId).catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [spaceId])

  useEffect(() => {
    document.title = 'Weft'
  }, [])

  const here = contents && contents.space.id === spaceId ? contents : null
  const folder = folderId && here ? (here.folders.find((f) => f.id === folderId) ?? null) : null

  const placeLabel = (to: Place) => {
    const spaceName = spaces?.find((s) => s.id === to.spaceId)?.name ?? 'that space'
    const folders = here && to.spaceId === here.space.id ? here.folders : []
    return [spaceName, ...ancestors(folders, to.folderId).map((f) => f.name)].join(' › ')
  }

  const drop = async (to: Place, dragged: Dragged) => {
    if (!here) return
    try {
      if (dragged.kind === 'project') {
        const project = here.projects.find((p) => p.id === dragged.id)
        if (!project || (project.spaceId === to.spaceId && project.folderId === to.folderId)) return
        await moveProject(project, to)
        toast(`Moved “${project.title}” to ${placeLabel(to)}.`, 'ok')
        return
      }
      const moving = here.folders.find((f) => f.id === dragged.id)
      if (!moving || moving.id === to.folderId || (moving.spaceId === to.spaceId && moving.parentId === to.folderId)) return
      if (moving.spaceId !== to.spaceId) {
        toast('Folders move within their space. Move the storyboards in it instead.', 'error')
        return
      }
      if (to.folderId && within(here.folders, moving.id).has(to.folderId)) {
        toast("A folder can't go inside itself.", 'error')
        return
      }
      await updateFolder(moving, { parentId: to.folderId })
      toast(`Moved “${moving.name}” to ${placeLabel(to)}.`, 'ok')
    } catch (error) {
      toastError(error)
    }
  }

  const actions: PlaceActions = {
    newSpace: () => setDialog({ kind: 'new-space' }),
    newFolder: (sId, parentId) => setDialog({ kind: 'new-folder', spaceId: sId, parentId }),
    renameFolder: (f) => setDialog({ kind: 'rename-folder', folder: f }),
    moveFolder: (f) => setDialog({ kind: 'move-folder', folder: f }),
    deleteFolder: (f) => setDialog({ kind: 'delete-folder', folder: f }),
    members: (s) => setDialog({ kind: 'members', space: s }),
    renameSpace: (s) => setDialog({ kind: 'rename-space', space: s }),
    deleteSpace: (s) => setDialog({ kind: 'delete-space', space: s }),
    drop: (to, dragged) => void drop(to, dragged),
  }

  let body
  if (spacesError) {
    body = (
      <div className="mt-8 flex items-center gap-3 rounded-lg border border-line bg-panel p-4 text-fg-2">
        <span className="flex-1">{spacesError}</span>
        <Button size="sm" onClick={loadSpaces}>
          Try again
        </Button>
      </div>
    )
  } else if (contentsError && spaceId) {
    body = (
      <div className="mt-10 max-w-md">
        <h1 className="text-[16px] font-semibold text-fg">This space isn't available</h1>
        <p className="mt-1.5 text-fg-2">It may have been deleted, or you may have been taken out of it. {contentsError !== 'Space not found' ? contentsError : ''}</p>
        <Button className="mt-4" onClick={() => navigate(spacePath(spaces?.[0]?.id ?? ''), { replace: true })} disabled={!spaces?.length}>
          Go to your own space
        </Button>
      </div>
    )
  } else if (!here) {
    body = (
      <div className="mt-10">
        <Spinner label="Loading…" />
      </div>
    )
  } else if (folderId && !folder) {
    body = (
      <div className="mt-10 max-w-md">
        <h1 className="text-[16px] font-semibold text-fg">This folder isn't here any more</h1>
        <p className="mt-1.5 text-fg-2">Someone may have moved or deleted it.</p>
        <Button className="mt-4" onClick={() => navigate(spacePath(here.space.id), { replace: true })}>
          Go to {here.space.name}
        </Button>
      </div>
    )
  } else {
    body = (
      <PlaceView
        contents={here}
        folder={folder}
        tab={tab}
        actions={actions}
        onNewStoryboard={() => setDialog({ kind: 'new-storyboard' })}
        onMoveProject={(project) => setDialog({ kind: 'move-project', project })}
        onDeleteProject={(project) => setDialog({ kind: 'delete-project', project })}
      />
    )
  }

  const place: Place | null = here ? { spaceId: here.space.id, folderId: folder?.id ?? null } : null

  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        {spaces && <Sidebar spaces={spaces} spaceId={spaceId} folderId={folderId} contents={here} actions={actions} onVault={() => setDialog({ kind: 'vault' })} />}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 pt-6 pb-16">{body}</div>
        </main>
      </div>

      {dialog?.kind === 'new-space' && (
        <NameDialog
          open
          onOpenChange={close}
          title="New team space"
          description="A shared home for a team's storyboards, folders and libraries. Add people once it's made."
          label="Name"
          placeholder="ASBL Ads"
          action="Make space"
          onSubmit={async (name) => {
            const space = await createSpace(name)
            navigate(spacePath(space.id))
          }}
        />
      )}
      {dialog?.kind === 'rename-space' && (
        <NameDialog
          open
          onOpenChange={close}
          title="Rename space"
          label="Name"
          initial={dialog.space.name}
          action="Rename"
          onSubmit={(name) => updateSpace(dialog.space.id, { name })}
        />
      )}
      {dialog?.kind === 'delete-space' && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={`Delete ${dialog.space.name}?`}
          description="Only an empty space can be deleted: move or delete its storyboards first. Its folders and libraries go with it, for everyone in it."
          action="Delete space"
          onConfirm={async () => {
            await deleteSpace(dialog.space.id)
            navigate('/', { replace: true })
          }}
        />
      )}
      {dialog?.kind === 'members' && <MembersDialog space={dialog.space} open onOpenChange={close} />}
      {dialog?.kind === 'new-folder' && (
        <NameDialog
          open
          onOpenChange={close}
          title="New folder"
          description={`In ${placeLabel({ spaceId: dialog.spaceId, folderId: dialog.parentId })}`}
          label="Name"
          placeholder="Broadway"
          action="Make folder"
          onSubmit={async (name) => {
            const made = await createFolder(dialog.spaceId, dialog.parentId, name)
            navigate(spacePath(made.spaceId, made.id))
          }}
        />
      )}
      {dialog?.kind === 'rename-folder' && (
        <NameDialog
          open
          onOpenChange={close}
          title="Rename folder"
          label="Name"
          initial={dialog.folder.name}
          action="Rename"
          onSubmit={(name) => updateFolder(dialog.folder, { name })}
        />
      )}
      {dialog?.kind === 'move-folder' && spaces && here && (
        <MoveDialog
          open
          onOpenChange={close}
          title={`Move “${dialog.folder.name}”`}
          spaces={spaces}
          folderOnly
          exclude={within(here.folders, dialog.folder.id)}
          from={{ spaceId: dialog.folder.spaceId, folderId: dialog.folder.parentId }}
          onMove={async (to) => {
            await updateFolder(dialog.folder, { parentId: to.folderId })
            toast(`Moved “${dialog.folder.name}” to ${placeLabel(to)}.`, 'ok')
          }}
        />
      )}
      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={`Delete “${dialog.folder.name}”?`}
          description={`Only an empty folder can be deleted: move or delete what's in it first.${
            here?.libraryCounts[dialog.folder.id] ? ` Its library (${plural(here.libraryCounts[dialog.folder.id]!, 'item')}) and notes go with it.` : ''
          }`}
          action="Delete folder"
          onConfirm={async () => {
            await deleteFolder(dialog.folder)
            if (folderId === dialog.folder.id) navigate(spacePath(dialog.folder.spaceId, dialog.folder.parentId), { replace: true })
          }}
        />
      )}
      {place && <NewStoryboardDialog open={dialog?.kind === 'new-storyboard'} onOpenChange={close} place={place} where={placeLabel(place)} />}
      {dialog?.kind === 'move-project' && spaces && (
        <MoveDialog
          open
          onOpenChange={close}
          title={`Move “${dialog.project.title}”`}
          spaces={spaces}
          from={{ spaceId: dialog.project.spaceId, folderId: dialog.project.folderId }}
          onMove={async (to) => {
            await moveProject(dialog.project, to)
            toast(`Moved “${dialog.project.title}”.`, 'ok')
          }}
        />
      )}
      {dialog?.kind === 'delete-project' && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title="Delete this storyboard?"
          description={`“${dialog.project.title}” will be removed for everyone in ${spaces?.find((s) => s.id === dialog.project.spaceId)?.name ?? 'its space'}.`}
          action="Delete storyboard"
          onConfirm={() => deleteProject(dialog.project)}
        />
      )}
      {dialog?.kind === 'vault' && <VaultDialog onOpenChange={close} place={place ?? undefined} />}
    </div>
  )
}

/** A space's top level or one of its folders: its storyboards, or its library. */
function PlaceView({
  contents,
  folder,
  tab,
  actions,
  onNewStoryboard,
  onMoveProject,
  onDeleteProject,
}: {
  contents: SpaceContents
  folder: FolderInfo | null
  tab: ProjectsLocation['tab']
  actions: PlaceActions
  onNewStoryboard: () => void
  onMoveProject: (project: ProjectSummary) => void
  onDeleteProject: (project: ProjectSummary) => void
}) {
  const space = contents.space
  const hereId = folder?.id ?? null
  const path = ancestors(contents.folders, hereId)
  const [query, setQuery] = useState('')
  const [sortPref, setSortPref] = usePref('projects-sort')
  const sort: SortKey = SORTS.find((s) => s.id === sortPref)?.id ?? 'edited'
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => setQuery(''), [space.id])
  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTyping(e.target) || document.querySelector('[role="dialog"], [role="menu"]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const storyboardCount = hereId ? countIn(contents, hereId) : contents.projects.length
  const libraryCount = contents.libraryCounts[hereId ?? ''] ?? 0
  const where = (p: { folderId: string | null }) => [space.name, ...ancestors(contents.folders, p.folderId).map((f) => f.name)].join(' › ')

  return (
    <>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs space={space} path={path} actions={actions} />
          <p className="mt-1 flex items-center gap-1.5 pl-1.5 text-[12px] text-fg-3">
            {space.kind === 'personal' ? (
              <>
                <Lock size={12} aria-hidden /> Only you see what's in this space.
              </>
            ) : (
              <>
                <Users size={12} aria-hidden />
                {space.members > 1 ? `Shared with ${space.members} people.` : 'Just you so far.'}
                <button type="button" onClick={() => actions.members(space)} className="font-medium text-fg-2 hover:text-fg hover:underline">
                  {space.role !== 'owner' ? 'See who' : space.members > 1 ? 'Add or remove people' : 'Add people'}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OpenFolderButton place={{ spaceId: space.id, folderId: hereId }} />
          <Button icon={<FolderPlus size={15} />} onClick={() => actions.newFolder(space.id, hereId)}>
            New folder
          </Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={onNewStoryboard}>
            New storyboard
          </Button>
        </div>
      </header>

      <div className="mt-5 flex min-h-[42px] flex-wrap items-end gap-3 border-b border-line">
        <div role="tablist" aria-label="Show" className="flex gap-5">
          {(
            [
              { id: 'storyboards', label: 'Storyboards', count: storyboardCount },
              { id: 'library', label: 'Library', count: libraryCount },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => navigate(spacePath(space.id, hereId, t.id))}
              className={cx(
                '-mb-px flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-[13px] font-medium transition-colors',
                tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-2 hover:text-fg',
              )}
            >
              {t.label}
              {t.count > 0 && <span className="font-normal text-fg-3 tabular-nums">{t.count}</span>}
            </button>
          ))}
        </div>
        {tab === 'storyboards' && (
          <div className="ml-auto flex items-center gap-2 pb-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" aria-hidden />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder={`Search ${space.name}`}
                aria-label="Search storyboards and folders"
                className="h-8 w-60 pl-8"
              />
            </div>
            <Menu
              trigger={
                <Button size="sm" variant="ghost" icon={<ArrowDownUp size={14} />} aria-label="Sort storyboards">
                  {SORTS.find((s) => s.id === sort)?.label}
                </Button>
              }
              items={SORTS.map((s) => ({ label: s.label, checked: s.id === sort, onSelect: () => setSortPref(s.id === 'edited' ? null : s.id) }))}
            />
          </div>
        )}
      </div>

      {tab === 'library' ? (
        <LibraryView spaceId={space.id} folderId={hereId} name={folder?.name ?? space.name} folders={contents.folders} />
      ) : query.trim() ? (
        <SearchResults contents={contents} query={query} sort={sort} where={where} actions={actions} onMoveProject={onMoveProject} onDeleteProject={onDeleteProject} />
      ) : (
        <FolderContents
          contents={contents}
          folder={folder}
          sort={sort}
          actions={actions}
          onNewStoryboard={onNewStoryboard}
          onMoveProject={onMoveProject}
          onDeleteProject={onDeleteProject}
        />
      )}
    </>
  )
}

function Breadcrumbs({ space, path, actions }: { space: SpaceSummary; path: readonly FolderInfo[]; actions: PlaceActions }) {
  const current = path.at(-1) ?? null
  return (
    <nav aria-label="Where you are" className="flex min-w-0 flex-wrap items-center gap-0.5">
      <Crumb label={space.name} icon={space.kind === 'personal' ? Lock : Users} to={{ spaceId: space.id, folderId: null }} current={!current} actions={actions} />
      {path.map((f, i) => (
        <Fragment key={f.id}>
          <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
          <Crumb label={f.name} to={{ spaceId: space.id, folderId: f.id }} current={i === path.length - 1} actions={actions} />
        </Fragment>
      ))}
      <Menu
        align="start"
        trigger={
          <IconButton size="sm" label={current ? `Options for ${current.name}` : `Options for ${space.name}`}>
            <MoreHorizontal size={16} />
          </IconButton>
        }
        items={current ? folderMenu(current, actions) : spaceMenu(space, actions)}
      />
    </nav>
  )
}

function Crumb({ label, icon: Icon, to, current, actions }: { label: string; icon?: LucideIcon; to: Place; current: boolean; actions: PlaceActions }) {
  const target = useMoveTarget((dragged) => actions.drop(to, dragged))
  return (
    <button
      type="button"
      {...target.props}
      onClick={() => navigate(spacePath(to.spaceId, to.folderId))}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[20px] font-semibold tracking-tight transition-colors',
        current ? 'text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        target.over && 'ring-2 ring-accent',
      )}
    >
      {Icon && <Icon size={16} className="shrink-0 text-fg-3" aria-hidden />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function FolderContents({
  contents,
  folder,
  sort,
  actions,
  onNewStoryboard,
  onMoveProject,
  onDeleteProject,
}: {
  contents: SpaceContents
  folder: FolderInfo | null
  sort: SortKey
  actions: PlaceActions
  onNewStoryboard: () => void
  onMoveProject: (project: ProjectSummary) => void
  onDeleteProject: (project: ProjectSummary) => void
}) {
  const hereId = folder?.id ?? null
  const folders = childrenOf(contents.folders, hereId)
  const storyboards = sorted(
    contents.projects.filter((p) => p.folderId === hereId),
    sort,
  )
  if (!folders.length && !storyboards.length) {
    const space = contents.space
    return (
      <div className="mt-8 flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
        <FolderOpen size={28} className="text-fg-3" aria-hidden />
        <h2 className="mt-3 text-[15px] font-semibold text-fg">{folder ? `${folder.name} is empty` : space.kind === 'personal' ? 'Your own space' : `${space.name} is empty`}</h2>
        <p className="mt-1 max-w-md text-fg-2">
          {folder
            ? 'Make a storyboard or a folder here, or drag storyboards in from elsewhere. Its Library tab holds notes and renders for everything inside.'
            : 'Make a folder for each thing you storyboard (a project, a client, a campaign) and storyboards inside it. Each folder has a Library for its notes, renders and clips, which Claude reads too.'}
        </p>
        <div className="mt-5 flex gap-2">
          <Button icon={<FolderPlus size={15} />} onClick={() => actions.newFolder(contents.space.id, hereId)}>
            New folder
          </Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={onNewStoryboard}>
            New storyboard
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6 pt-5">
      {folders.length > 0 && (
        <section aria-label="Folders">
          {storyboards.length > 0 && <h2 className="mb-2 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Folders</h2>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {folders.map((f) => (
              <FolderTile key={f.id} folder={f} contents={contents} actions={actions} />
            ))}
          </ul>
        </section>
      )}
      {storyboards.length > 0 && (
        <section aria-label="Storyboards">
          {folders.length > 0 && <h2 className="mb-2 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Storyboards</h2>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {storyboards.map((p) => (
              <StoryboardCard key={p.id} project={p} onMove={() => onMoveProject(p)} onDelete={() => onDeleteProject(p)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function SearchResults({
  contents,
  query,
  sort,
  where,
  actions,
  onMoveProject,
  onDeleteProject,
}: {
  contents: SpaceContents
  query: string
  sort: SortKey
  where: (p: { folderId: string | null }) => string
  actions: PlaceActions
  onMoveProject: (project: ProjectSummary) => void
  onDeleteProject: (project: ProjectSummary) => void
}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w))
  const folders = contents.folders.filter((f) => hit(f.name))
  const storyboards = sorted(
    contents.projects.filter((p) => hit(`${p.title} ${where(p)}`)),
    sort,
  )
  if (!folders.length && !storyboards.length) return <p className="pt-8 text-fg-2">Nothing in {contents.space.name} matches “{query.trim()}”.</p>
  return (
    <div className="flex flex-col gap-6 pt-5">
      {folders.length > 0 && (
        <section aria-label="Folders found">
          <h2 className="mb-2 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Folders</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {folders.map((f) => (
              <FolderTile key={f.id} folder={f} contents={contents} actions={actions} path={where({ folderId: f.parentId })} />
            ))}
          </ul>
        </section>
      )}
      {storyboards.length > 0 && (
        <section aria-label="Storyboards found">
          <h2 className="mb-2 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Storyboards</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {storyboards.map((p) => (
              <StoryboardCard key={p.id} project={p} path={where(p)} onMove={() => onMoveProject(p)} onDelete={() => onDeleteProject(p)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FolderTile({ folder, contents, actions, path }: { folder: FolderInfo; contents: SpaceContents; actions: PlaceActions; path?: string }) {
  const target = useMoveTarget((dragged) => actions.drop({ spaceId: folder.spaceId, folderId: folder.id }, dragged))
  const storyboards = countIn(contents, folder.id)
  const library = contents.libraryCounts[folder.id] ?? 0
  const facts = [plural(storyboards, 'storyboard'), library ? `${library} in library` : null].filter(Boolean)
  return (
    <li className="group relative" {...target.props}>
      <button
        type="button"
        draggable
        onDragStart={(e) => startMoveDrag(e, { kind: 'folder', id: folder.id })}
        onClick={() => navigate(spacePath(folder.spaceId, folder.id))}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl border bg-panel px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-raised',
          target.over ? 'border-accent ring-2 ring-accent' : 'border-line',
        )}
      >
        <Folder size={20} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 pr-6">
          <span className="block truncate text-[14px] font-medium text-fg">{folder.name}</span>
          {path && <span className="block truncate text-[12px] text-fg-2">in {path}</span>}
          <span className="block truncate text-[12px] text-fg-3">{facts.join(' · ')}</span>
        </span>
      </button>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu
          trigger={
            <IconButton size="sm" label={`Options for ${folder.name}`}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={folderMenu(folder, actions)}
        />
      </div>
    </li>
  )
}

function StoryboardCard({ project, path, onMove, onDelete }: { project: ProjectSummary; path?: string; onMove: () => void; onDelete: () => void }) {
  const Icon = TYPE_ICONS[project.type] ?? Clapperboard
  return (
    <li className="group relative">
      <button
        type="button"
        draggable
        onDragStart={(e) => startMoveDrag(e, { kind: 'project', id: project.id })}
        onClick={() => navigate(projectPath(project.id))}
        title="Open it, or drag it onto a folder to move it"
        className="flex w-full flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong hover:bg-raised"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
          <Icon size={17} aria-hidden />
        </span>
        <span className="mt-4 truncate pr-6 text-[14px] font-semibold text-fg">{project.title}</span>
        {path && <span className="mt-0.5 truncate text-[12px] text-fg-2">in {path}</span>}
        <span className="mt-1 text-[12px] text-fg-3">
          {TYPE_LABELS[project.type] ?? project.type} · edited {timeAgo(project.updatedAt)}
          {project.createdBy ? ` · by ${project.createdBy.name}` : ''}
        </span>
      </button>
      <div className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu
          trigger={
            <IconButton size="sm" label={`Options for ${project.title}`}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={[
            { label: 'Open', icon: <SquareArrowOutUpRight size={14} />, onSelect: () => navigate(projectPath(project.id)) },
            { label: 'Move to…', icon: <FolderInput size={14} />, onSelect: onMove },
            'separator',
            { label: 'Delete storyboard', icon: <Trash2 size={14} />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  )
}

/** The vault (a copy of every project on this computer), in a dialog. */
function VaultDialog({ onOpenChange, place }: { onOpenChange: (open: boolean) => void; place?: Place }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  useEffect(() => {
    api<{ projects: ProjectSummary[] }>('/api/projects').then((r) => setProjects(r.projects), toastError)
  }, [])
  return (
    <Modal open onOpenChange={onOpenChange} width={640} title="Keep a copy on this computer">
      <VaultPanel projects={projects} place={place} />
    </Modal>
  )
}

const TARGETS: Record<ProjectType, number[]> = { ad: [6, 15, 30, 60], film: [], other: [] }

function NewStoryboardDialog({ open, onOpenChange, place, where }: { open: boolean; onOpenChange: (open: boolean) => void; place: Place; where: string }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ProjectType>('ad')
  const [aspect, setAspect] = useState<AspectRatio>('16:9')
  const [target, setTarget] = useState<string>('30')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setType('ad')
    setAspect('16:9')
    setTarget('30')
  }, [open])

  const chooseType = (next: ProjectType) => {
    setType(next)
    setAspect(PROJECT_DEFAULTS[next].aspect)
    const seconds = PROJECT_DEFAULTS[next].targetDuration
    setTarget(seconds === null ? '' : String(seconds))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const seconds = target.trim() ? Number(target) * (type === 'film' ? 60 : 1) : null
    setBusy(true)
    try {
      const { project } = await api<{ project: ProjectSummary }>('/api/projects', {
        method: 'POST',
        body: {
          title: title.trim(),
          type,
          aspect,
          targetDuration: seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
          spaceId: place.spaceId,
          folderId: place.folderId,
        },
      })
      onOpenChange(false)
      navigate(projectPath(project.id))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New storyboard" description={`In ${where}`} width={480}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Title" htmlFor="project-title">
          <Input
            id="project-title"
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Broadway launch 30s"
          />
        </Field>
        <Field label="Type">
          <Segmented<ProjectType>
            label="Project type"
            options={[
              { id: 'ad', label: 'Ad' },
              { id: 'film', label: 'Short film' },
              { id: 'other', label: 'Other' },
            ]}
            value={type}
            onChange={(v) => v && chooseType(v)}
          />
        </Field>
        <Field label="Format">
          <Segmented<AspectRatio>
            label="Aspect ratio"
            options={ASPECT_RATIOS.map((a) => ({
              id: a,
              label: a,
              title: a === '9:16' ? 'Vertical (Reels, Shorts)' : a === '2.39:1' ? 'Cinemascope' : undefined,
            }))}
            value={aspect}
            onChange={(v) => v && setAspect(v)}
          />
        </Field>
        <Field label={type === 'film' ? 'Target length (minutes)' : 'Target length (seconds)'} hint="Optional">
          <div className="flex items-center gap-2">
            {TARGETS[type].length > 0 && (
              <Segmented<string>
                label="Common lengths"
                options={TARGETS[type].map((t) => ({ id: String(t), label: `${t}s` }))}
                value={TARGETS[type].map(String).includes(target) ? target : null}
                onChange={(v) => setTarget(v ?? '')}
              />
            )}
            <Input
              aria-label="Target length"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={type === 'film' ? '30' : 'None'}
              className="w-24"
            />
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!title.trim()}>
            Create storyboard
          </Button>
        </div>
      </form>
    </Modal>
  )
}
