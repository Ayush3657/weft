import { FolderCheck, FolderInput, FolderLock, FolderSync, FolderX, HardDrive, RefreshCw, Save, X } from 'lucide-react'
import { cx } from '../lib/cx'
import { toastError } from '../lib/toast'
import { useProjectContext } from '../project/ProjectProvider'
import { IconButton, Menu, type MenuItem } from '../ui'
import { useProjectVault } from './useVault'
import { chooseProjectFolder, chooseVault, resumeVault, stopSaving } from './vault'

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  return m === 1 ? 'a minute ago' : m < 60 ? `${m} minutes ago` : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Ignores the person closing a folder picker without choosing. */
const unlessCancelled = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') return
  toastError(error)
}

/** The header button for this project's copy on this computer. */
export function VaultButton() {
  const view = useProjectVault()
  const { projectId, project } = useProjectContext()
  const title = () => project.getMeta().title

  if (view.kind === 'unsupported' || view.kind === 'loading') return null

  const chooseFolder: MenuItem = {
    label: 'Save to a different folder…',
    icon: <FolderInput size={14} />,
    onSelect: () => void chooseProjectFolder(projectId, title()).catch(unlessCancelled),
  }
  const changeVault: MenuItem = {
    label: 'Change the vault folder…',
    icon: <HardDrive size={14} />,
    onSelect: () => void chooseVault().catch(unlessCancelled),
  }

  if (view.kind === 'none' && view.notKept) {
    return (
      <Menu
        header={
          <span className="block max-w-[260px]">
            Your vault doesn't keep this storyboard's space. Choose the spaces it keeps under “Keep a copy on this computer” on the projects page.
          </span>
        }
        trigger={
          <IconButton label="Not kept on this computer" tooltip="Not kept in your vault">
            <HardDrive size={16} />
          </IconButton>
        }
        items={[{ ...chooseFolder, label: 'Save just this storyboard to a folder…' }]}
      />
    )
  }

  if (view.kind === 'none') {
    return (
      <Menu
        header={
          <span className="block max-w-[260px]">
            Keep a copy of this project in a folder on this computer. Weft keeps it up to date while the project is open.
          </span>
        }
        trigger={
          <IconButton label="Keep a copy on this computer" tooltip="Keep a copy on this computer">
            <HardDrive size={16} />
          </IconButton>
        }
        items={
          view.hasVault
            ? [
                { label: 'Keep it in the vault again', icon: <FolderCheck size={14} />, onSelect: () => void resumeVault(projectId) },
                { ...chooseFolder, label: 'Save to a folder…' },
              ]
            : [
                { label: 'Choose a vault folder for all projects…', icon: <HardDrive size={14} />, onSelect: () => void chooseVault().catch(unlessCancelled) },
                { ...chooseFolder, label: 'Save just this project to a folder…' },
              ]
        }
      />
    )
  }

  if (view.kind === 'error') {
    return (
      <IconButton label={view.message} className="text-warn">
        <FolderX size={16} />
      </IconButton>
    )
  }

  const needsPermission = view.kind === 'needs-permission' || view.state.kind === 'needs-permission'
  if (needsPermission) {
    const reconnect = view.kind === 'needs-permission' ? view.reconnect : () => view.mirror.reconnect().then(() => undefined)
    return (
      <IconButton
        label={`Allow Weft to keep saving to ${view.label}`}
        tooltip={`Click to let Weft keep saving to “${view.label}” (your browser asks once per visit)`}
        className="text-warn"
        onClick={() => void reconnect().catch(toastError)}
      >
        <FolderLock size={16} />
      </IconButton>
    )
  }

  const { state, label, mirror } = view
  const status =
    state.kind === 'saved'
      ? `Saved to “${label}” ${ago(state.at)}`
      : state.kind === 'error'
        ? `Couldn't save to “${label}”: ${state.message}`
        : state.kind === 'saving' && state.detail
          ? `${state.detail} to “${label}”…`
          : `Saving to “${label}”…`
  const Icon = state.kind === 'saved' ? FolderCheck : state.kind === 'error' ? FolderX : FolderSync

  return (
    <Menu
      header={<span className="block max-w-[280px] break-words">{status}</span>}
      trigger={
        <IconButton
          label={status}
          tooltip={status}
          className={cx(state.kind === 'error' ? 'text-warn' : state.kind === 'saved' ? 'text-fg-3' : 'text-fg-2')}
        >
          <Icon size={16} className={state.kind === 'saving' || state.kind === 'starting' ? 'animate-pulse' : undefined} />
        </IconButton>
      }
      items={[
        { label: state.kind === 'error' ? 'Try again' : 'Save now', icon: state.kind === 'error' ? <RefreshCw size={14} /> : <Save size={14} />, onSelect: () => void mirror.save() },
        chooseFolder,
        ...(view.inVault ? [changeVault] : []),
        'separator' as const,
        {
          label: view.inVault ? 'Stop keeping it in the vault' : 'Stop saving to this folder',
          icon: <X size={14} />,
          onSelect: () => void stopSaving(projectId),
        },
      ]}
    />
  )
}

