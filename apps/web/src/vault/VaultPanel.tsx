import { AlertTriangle, FolderOpen, HardDrive, Lock, RefreshCw, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SpaceSummary } from '../lib/api'
import { cx } from '../lib/cx'
import { usePref } from '../lib/prefs'
import { navigate, projectPath } from '../lib/router'
import { toast, toastError } from '../lib/toast'
import { Button } from '../ui'
import { vaultSupported } from './fs'
import { SKIP_PREF, keeper, useKeeperStatus, type Orphan } from './keeper'
import { allowVault, chooseVault, getVault, openFolder, pickAndOpenFolder, setVault, useVaultVersion, type ImportPlace } from './vault'

const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

async function open(run: () => Promise<{ id: string; existed: boolean; restored: boolean; title: string }>) {
  try {
    const { id, existed, restored, title } = await run()
    toast(
      existed
        ? `“${title}” was already here, so Weft merged in the folder's copy.`
        : restored
          ? `Brought “${title}” back from its folder.`
          : `Opened “${title}” from its folder.`,
      'ok',
    )
    navigate(projectPath(id))
  } catch (error) {
    if (!cancelled(error)) toastError(error)
  }
}

export function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

/** The vault's name, once it's known (null: no vault). */
export function useVaultName(): string | null | undefined {
  const version = useVaultVersion()
  const [name, setName] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!vaultSupported()) return
    let stale = false
    void getVault().then((v) => !stale && setName(v?.name ?? null))
    return () => {
      stale = true
    }
  }, [version])
  return name
}

/** Everything about the vault: where it is, how it's going, which spaces it keeps, and what's in it that Weft doesn't have. */
export function VaultSettings({ spaces, place }: { spaces: readonly SpaceSummary[]; place?: ImportPlace }) {
  const name = useVaultName()
  const status = useKeeperStatus()
  const [skipRaw, setSkipRaw] = usePref(SKIP_PREF)
  const skip = new Set<string>(JSON.parse(skipRaw ?? '[]') as string[])
  const [opening, setOpening] = useState<string | null>(null)

  if (!vaultSupported()) {
    return <p className="text-fg-2">Keeping a copy on this computer works in Chrome and Edge. Open Weft in one of them to set it up.</p>
  }
  if (name === undefined) return null

  const choose = () => void chooseVault().catch((error: unknown) => !cancelled(error) && toastError(error))

  if (!name) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-fg-2">
          Choose a folder and Weft keeps a copy of your storyboards in it, laid out like Weft: a folder for each space, its folders inside, a folder for
          each storyboard (its pictures and clips, script, notes and a readable project.json), and each folder's library. It's your own backup, readable
          without Weft.
        </p>
        <p className="text-[12px] text-fg-3">
          Put it inside OneDrive or Google Drive and it's backed up to the cloud too, and you can open it from your other computers.
        </p>
        <Button className="self-start" variant="primary" icon={<HardDrive size={15} />} onClick={choose}>
          Choose a vault folder
        </Button>
      </div>
    )
  }

  const toggle = (spaceId: string, keep: boolean) => {
    const next = new Set(skip)
    if (keep) next.delete(spaceId)
    else next.add(spaceId)
    setSkipRaw(next.size ? JSON.stringify([...next]) : null)
    keeper.soon(500)
  }

  const orphans: Orphan[] = 'orphans' in status ? status.orphans : []
  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-3 rounded-xl border border-line bg-bg px-4 py-3">
        <HardDrive size={18} className="shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{name}</p>
          <Status />
        </div>
        {status.kind === 'needs-permission' ? (
          <Button size="sm" variant="primary" onClick={() => void allowVault()}>
            Allow access
          </Button>
        ) : (
          <Button size="sm" icon={<RefreshCw size={14} />} disabled={status.kind === 'saving'} onClick={() => void keeper.run()}>
            Save now
          </Button>
        )}
      </section>

      {status.kind === 'idle' && status.problems.length > 0 && (
        <section className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[12px] text-fg-2">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            <AlertTriangle size={13} className="text-warn" aria-hidden /> Some things weren't saved
          </p>
          {status.problems.slice(0, 5).map((p) => (
            <p key={p}>{p}</p>
          ))}
          {status.problems.length > 5 && <p>…and {status.problems.length - 5} more.</p>}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">Spaces kept here</h3>
        <ul className="flex flex-col">
          {spaces.map((s) => (
            <li key={s.id}>
              <label className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-fg hover:bg-hover">
                <input type="checkbox" checked={!skip.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                {s.kind === 'personal' ? <Lock size={13} className="text-fg-3" aria-hidden /> : <Users size={13} className="text-fg-3" aria-hidden />}
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[12px] text-fg-3 tabular-nums">{s.projects ? `${s.projects} ${s.projects === 1 ? 'storyboard' : 'storyboards'}` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-fg-3">
          Rename or move things in Weft and the vault follows. Anything taken out of Weft stays in the vault, where you can open it again below.
        </p>
      </section>

      {orphans.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">In the vault, not in Weft</h3>
          <ul className="flex flex-col">
            {orphans.map((o) => (
              <li key={o.projectId} className="flex h-9 items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-fg">
                  {o.title}
                  {o.place && <span className="text-fg-3"> · was in {[o.place.space, ...o.place.folders].join(' › ')}</span>}
                </span>
                <Button
                  size="sm"
                  busy={opening === o.projectId}
                  onClick={() => {
                    setOpening(o.projectId)
                    void open(() => openFolder(o.dir, place)).finally(() => setOpening(null))
                  }}
                >
                  Open in Weft
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={choose}>
          Use another folder…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setVault(null)}>
          Stop using a vault
        </Button>
      </div>
    </div>
  )
}

/** One line on how the vault is doing. */
export function Status({ className }: { className?: string }) {
  const status = useKeeperStatus()
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  if (status.kind === 'saving') {
    return (
      <div className={cx('flex flex-col gap-1', className)}>
        <p className="truncate text-[12px] text-fg-2">{status.total ? `${status.detail} (${status.done + 1} of ${status.total})` : status.detail}</p>
        {status.total > 0 && (
          <span className="h-1 w-full overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${(status.done / status.total) * 100}%` }} />
          </span>
        )}
      </div>
    )
  }
  const text =
    status.kind === 'needs-permission'
      ? 'Your browser needs your OK before Weft can write to it again.'
      : status.kind === 'idle'
        ? status.at
          ? `${status.kept} ${status.kept === 1 ? 'storyboard' : 'storyboards'} kept · saved ${ago(status.at)}`
          : 'Not saved yet'
        : 'Starting…'
  return <p className={cx('truncate text-[12px]', status.kind === 'needs-permission' ? 'text-warn' : 'text-fg-2', className)}>{text}</p>
}
