import { FolderOpen, HardDrive } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../lib/api'
import { navigate, projectPath } from '../lib/router'
import { toast, toastError } from '../lib/toast'
import { Button } from '../ui'
import { folderPermission, vaultSupported } from './fs'
import { chooseVault, getVault, openFolder, pickAndOpenFolder, setVault, useVaultVersion, vaultOnlyProjects, type FolderProject, type ImportPlace } from './vault'

const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

async function open(run: () => Promise<{ id: string; existed: boolean; title: string }>) {
  try {
    const { id, existed, title } = await run()
    toast(existed ? `“${title}” was already here, so Weft merged in the folder's copy.` : `Opened “${title}” from its folder.`, 'ok')
    navigate(projectPath(id))
  } catch (error) {
    if (!cancelled(error)) toastError(error)
  }
}

/** "Open from folder…", for the projects page header. A project new to this server lands in `place`. */
export function OpenFolderButton({ place }: { place?: ImportPlace }) {
  const [busy, setBusy] = useState(false)
  if (!vaultSupported()) return null
  return (
    <Button
      icon={<FolderOpen size={15} />}
      busy={busy}
      onClick={() => {
        setBusy(true)
        void open(() => pickAndOpenFolder(place)).finally(() => setBusy(false))
      }}
    >
      Open from folder…
    </Button>
  )
}

/** The vault on the projects page: choose it, and open projects in it that this server doesn't have. */
export function VaultPanel({ projects, place }: { projects: ProjectSummary[] | null; place?: ImportPlace }) {
  const version = useVaultVersion()
  const [vault, setVaultHandle] = useState<FileSystemDirectoryHandle | null | undefined>(undefined)
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const [elsewhere, setElsewhere] = useState<FolderProject[]>([])
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    if (!vaultSupported()) return
    let stale = false
    void getVault().then(async (v) => {
      const p = v ? await folderPermission(v, false) : null
      if (stale) return
      setVaultHandle(v)
      setPermission(p)
    })
    return () => {
      stale = true
    }
  }, [version])

  useEffect(() => {
    if (!vault || permission !== 'granted' || !projects) {
      setElsewhere([])
      return
    }
    let stale = false
    vaultOnlyProjects(vault, projects)
      .then((found) => !stale && setElsewhere(found))
      .catch(() => !stale && setElsewhere([]))
    return () => {
      stale = true
    }
  }, [vault, permission, projects])

  if (!vaultSupported() || vault === undefined) return null

  const choose = () => void chooseVault().catch((error: unknown) => !cancelled(error) && toastError(error))

  if (!vault) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3.5">
        <HardDrive size={18} className="shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">Keep a copy of every project on this computer</p>
          <p className="mt-0.5 text-fg-2">
            Choose a vault folder and Weft keeps each project you open in a folder of its own there: its pictures and clips, the script and
            notes, and a readable project.json. Back it up anywhere, or open it on another computer.
          </p>
        </div>
        <Button onClick={choose}>Choose a vault folder</Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <HardDrive size={16} className="shrink-0 text-fg-3" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-fg-2">
          Projects you open are kept in your vault, <span className="font-medium text-fg">{vault.name}</span>.
        </p>
        {permission !== 'granted' && (
          <Button size="sm" variant="primary" onClick={() => void folderPermission(vault, true).then(setPermission)}>
            Allow access
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={choose}>
          Change
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setVault(null)}>
          Stop using a vault
        </Button>
      </div>
      {elsewhere.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[12px] text-fg-3">In your vault but not on this server yet</p>
          <ul className="flex flex-wrap gap-2">
            {elsewhere.map((p) => (
              <li key={p.dir.name}>
                <Button
                  size="sm"
                  icon={<FolderOpen size={14} />}
                  busy={opening === p.dir.name}
                  onClick={() => {
                    setOpening(p.dir.name)
                    void open(() => openFolder(p.dir, place)).finally(() => setOpening(null))
                  }}
                >
                  {p.title}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
