import { ChevronDown, ChevronRight, Folder, FolderInput, FolderPlus, HardDrive, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useMemo } from 'react'
import type { FolderInfo, SpaceContents, SpaceSummary } from '../lib/api'
import { cx } from '../lib/cx'
import { usePref } from '../lib/prefs'
import { navigate, spacePath } from '../lib/router'
import { ContextMenuArea, IconButton, type MenuItem } from '../ui'
import { vaultSupported } from '../vault/fs'
import { useKeeperStatus } from '../vault/keeper'
import { Status, useVaultName } from '../vault/VaultPanel'
import { startMoveDrag, useMoveTarget, type Dragged } from './dnd'
import { ancestors, childrenOf, countIn } from './store'

export interface PlaceActions {
  newSpace: () => void
  newFolder: (spaceId: string, parentId: string | null) => void
  renameFolder: (folder: FolderInfo) => void
  moveFolder: (folder: FolderInfo) => void
  deleteFolder: (folder: FolderInfo) => void
  members: (space: SpaceSummary) => void
  renameSpace: (space: SpaceSummary) => void
  deleteSpace: (space: SpaceSummary) => void
  /** Something was dropped on a space or folder: move it there. */
  drop: (to: { spaceId: string; folderId: string | null }, dragged: Dragged) => void
}

export function spaceMenu(space: SpaceSummary, actions: PlaceActions): Array<MenuItem | 'separator'> {
  if (space.kind === 'personal') return [{ label: 'New folder', icon: <FolderPlus size={14} />, onSelect: () => actions.newFolder(space.id, null) }]
  return [
    { label: 'People…', icon: <Users size={14} />, onSelect: () => actions.members(space) },
    { label: 'New folder', icon: <FolderPlus size={14} />, onSelect: () => actions.newFolder(space.id, null) },
    'separator',
    { label: 'Rename space…', icon: <Pencil size={14} />, disabled: space.role !== 'owner', onSelect: () => actions.renameSpace(space) },
    { label: 'Delete space…', icon: <Trash2 size={14} />, danger: true, disabled: space.role !== 'owner', onSelect: () => actions.deleteSpace(space) },
  ]
}

export function folderMenu(folder: FolderInfo, actions: PlaceActions): Array<MenuItem | 'separator'> {
  return [
    { label: 'New folder inside', icon: <FolderPlus size={14} />, onSelect: () => actions.newFolder(folder.spaceId, folder.id) },
    { label: 'Rename…', icon: <Pencil size={14} />, onSelect: () => actions.renameFolder(folder) },
    { label: 'Move to…', icon: <FolderInput size={14} />, onSelect: () => actions.moveFolder(folder) },
    'separator',
    { label: 'Delete folder…', icon: <Trash2 size={14} />, danger: true, onSelect: () => actions.deleteFolder(folder) },
  ]
}

/** Folders you've opened in the tree, remembered on this computer. */
function useOpenFolders(): [ReadonlySet<string>, (folderId: string, open: boolean) => void] {
  const [raw, setRaw] = usePref('folders-open')
  const open = useMemo(() => {
    try {
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set<string>()
    }
  }, [raw])
  const set = (folderId: string, value: boolean) => {
    const next = new Set(open)
    if (value) next.add(folderId)
    else next.delete(folderId)
    setRaw(next.size ? JSON.stringify([...next]) : null)
  }
  return [open, set]
}

/** The spaces you're in, with the current one's folders, as a tree. */
export function Sidebar({
  spaces,
  spaceId,
  folderId,
  contents,
  actions,
  onVault,
}: {
  spaces: readonly SpaceSummary[]
  spaceId: string | null
  folderId: string | null
  contents: SpaceContents | null
  actions: PlaceActions
  onVault: () => void
}) {
  const [stored, setOpen] = useOpenFolders()
  // The folders above the one you're in are always open.
  const open = useMemo(() => {
    const all = new Set(stored)
    if (contents) for (const f of ancestors(contents.folders, folderId).slice(0, -1)) all.add(f.id)
    return all
  }, [stored, contents, folderId])

  return (
    <aside aria-label="Spaces and folders" className="flex w-[248px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">Spaces</h2>
        <IconButton size="sm" label="New team space" tooltip="New team space" onClick={actions.newSpace}>
          <Plus size={15} />
        </IconButton>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {spaces.map((space) => (
          <div key={space.id} className="mb-0.5">
            <SpaceRow space={space} current={space.id === spaceId} selected={space.id === spaceId && !folderId} actions={actions} />
            {space.id === spaceId && contents?.space.id === space.id && (
              <FolderBranch contents={contents} parentId={null} depth={1} folderId={folderId} open={open} setOpen={setOpen} actions={actions} />
            )}
          </div>
        ))}
      </nav>
      <VaultEntry onClick={onVault} />
    </aside>
  )
}

function SpaceRow({ space, current, selected, actions }: { space: SpaceSummary; current: boolean; selected: boolean; actions: PlaceActions }) {
  const target = useMoveTarget((dragged) => actions.drop({ spaceId: space.id, folderId: null }, dragged))
  const Icon = space.kind === 'personal' ? Lock : Users
  return (
    <ContextMenuArea items={spaceMenu(space, actions)}>
      <button
        type="button"
        {...target.props}
        onClick={() => navigate(spacePath(space.id))}
        aria-current={selected ? 'page' : undefined}
        title={space.kind === 'personal' ? 'Only you see what’s here' : `${space.members} ${space.members === 1 ? 'person' : 'people'}`}
        className={cx(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
          selected ? 'bg-accent-soft font-medium text-fg' : current ? 'font-medium text-fg hover:bg-hover' : 'text-fg-2 hover:bg-hover hover:text-fg',
          target.over && 'ring-2 ring-accent',
        )}
      >
        <Icon size={14} className="shrink-0 text-fg-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{space.name}</span>
        <span className="text-[11px] text-fg-3 tabular-nums">{space.projects || ''}</span>
      </button>
    </ContextMenuArea>
  )
}

function FolderBranch({
  contents,
  parentId,
  depth,
  folderId,
  open,
  setOpen,
  actions,
}: {
  contents: SpaceContents
  parentId: string | null
  depth: number
  folderId: string | null
  open: ReadonlySet<string>
  setOpen: (folderId: string, open: boolean) => void
  actions: PlaceActions
}) {
  return (
    <ul>
      {childrenOf(contents.folders, parentId).map((folder) => {
        const hasChildren = contents.folders.some((f) => f.parentId === folder.id)
        const expanded = hasChildren && open.has(folder.id)
        return (
          <li key={folder.id}>
            <FolderRow
              folder={folder}
              depth={depth}
              count={countIn(contents, folder.id)}
              selected={folder.id === folderId}
              hasChildren={hasChildren}
              expanded={expanded}
              onToggle={() => setOpen(folder.id, !expanded)}
              actions={actions}
            />
            {expanded && <FolderBranch contents={contents} parentId={folder.id} depth={depth + 1} folderId={folderId} open={open} setOpen={setOpen} actions={actions} />}
          </li>
        )
      })}
    </ul>
  )
}

function FolderRow({
  folder,
  depth,
  count,
  selected,
  hasChildren,
  expanded,
  onToggle,
  actions,
}: {
  folder: FolderInfo
  depth: number
  count: number
  selected: boolean
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
  actions: PlaceActions
}) {
  const target = useMoveTarget((dragged) => actions.drop({ spaceId: folder.spaceId, folderId: folder.id }, dragged))
  return (
    <ContextMenuArea items={folderMenu(folder, actions)}>
      <div
        {...target.props}
        draggable
        onDragStart={(e) => startMoveDrag(e, { kind: 'folder', id: folder.id })}
        style={{ paddingLeft: depth * 14 }}
        className={cx(
          'group flex h-8 items-center rounded-md text-[13px] transition-colors',
          selected ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
          target.over && 'ring-2 ring-accent',
        )}
      >
        <button
          type="button"
          tabIndex={hasChildren ? 0 : -1}
          aria-label={expanded ? `Close ${folder.name}` : `Open ${folder.name}`}
          onClick={onToggle}
          className={cx('flex size-6 shrink-0 items-center justify-center rounded text-fg-3 hover:text-fg', !hasChildren && 'invisible')}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          type="button"
          onClick={() => navigate(spacePath(folder.spaceId, folder.id))}
          aria-current={selected ? 'page' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left"
        >
          <Folder size={14} className="shrink-0 text-fg-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          <span className="text-[11px] text-fg-3 tabular-nums">{count || ''}</span>
        </button>
      </div>
    </ContextMenuArea>
  )
}

function VaultEntry({ onClick }: { onClick: () => void }) {
  const name = useVaultName()
  const status = useKeeperStatus()
  if (!vaultSupported() || name === undefined) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-start gap-2.5 border-t border-line px-4 py-2.5 text-left text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
    >
      <HardDrive size={14} className={cx('mt-0.5 shrink-0', status.kind === 'needs-permission' ? 'text-warn' : 'text-fg-3')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name ? `Vault: ${name}` : 'Keep a copy on this computer…'}</span>
        {name && <Status className="text-[11px]" />}
      </span>
    </button>
  )
}
