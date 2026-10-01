import { useEffect, useState } from 'react'
import { useProjectContext } from '../project/ProjectProvider'
import { folderPermission, vaultSupported } from './fs'
import { VaultMirror, type MirrorState } from './mirror'
import { projectFolder, useVaultVersion } from './vault'

export type VaultView =
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'none'; hasVault: boolean; off: boolean }
  /** The browser needs a click before Weft may use the vault again (after a restart, say). */
  | { kind: 'needs-permission'; label: string; reconnect: () => Promise<void> }
  | { kind: 'mirror'; label: string; inVault: boolean; state: MirrorState; mirror: VaultMirror }
  | { kind: 'error'; message: string }

/** Keeps the open project's folder up to date, and says how that's going. */
export function useProjectVault(): VaultView {
  const { projectId, doc, project } = useProjectContext()
  const version = useVaultVersion()
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<VaultView>(() => (vaultSupported() ? { kind: 'loading' } : { kind: 'unsupported' }))

  useEffect(() => {
    if (!vaultSupported()) return
    let cancelled = false
    let mirror: VaultMirror | null = null
    let unsubscribe = () => {}
    projectFolder(projectId, project.getMeta().title)
      .then((where) => {
        if (cancelled) return
        if (where.kind === 'none') {
          setView(where)
          return
        }
        if (where.kind === 'needs-permission') {
          setView({
            kind: 'needs-permission',
            label: where.label,
            reconnect: async () => {
              if ((await folderPermission(where.vault, true)) === 'granted') setRetry((n) => n + 1)
            },
          })
          return
        }
        const m = new VaultMirror(doc, project, projectId, where.dir, where.adopt)
        mirror = m
        const show = () => setView({ kind: 'mirror', label: where.label, inVault: where.inVault, state: m.getState(), mirror: m })
        unsubscribe = m.subscribe(show)
        show()
        void m.start()
      })
      .catch((error: unknown) => {
        if (!cancelled) setView({ kind: 'error', message: error instanceof Error ? error.message : "Couldn't open the folder" })
      })
    return () => {
      cancelled = true
      unsubscribe()
      mirror?.stop()
    }
  }, [projectId, doc, project, version, retry])

  return view
}
