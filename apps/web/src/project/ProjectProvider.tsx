import { HocuspocusProvider } from '@hocuspocus/provider'
import { Project, SnapshotStore } from '@weft/model'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { useUser } from '../lib/auth'

export interface ProjectContextValue {
  projectId: string
  doc: Y.Doc
  project: Project
  store: SnapshotStore
  undo: Y.UndoManager
  provider: HocuspocusProvider
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

function syncUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/sync`
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; value: ProjectContextValue } | { kind: 'denied'; reason: string }

/**
 * Opens a project: a Yjs document kept in this browser (IndexedDB, so it works
 * offline) and synced live with the server. Everyone editing the same project
 * is connected to the same document.
 */
export function ProjectProvider({
  projectId,
  children,
  loading,
  denied,
}: {
  projectId: string
  children: ReactNode
  loading: ReactNode
  denied: (reason: string) => ReactNode
}) {
  const user = useUser()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const doc = new Y.Doc()
    const origin = { source: 'local', userId: user.id }
    const project = new Project(doc, origin)
    const local = new IndexeddbPersistence(`weft/project/${projectId}`, doc)
    const provider = new HocuspocusProvider({
      url: syncUrl(),
      name: `project/${projectId}`,
      document: doc,
      // Browsers are identified by their session cookie; the server ignores this placeholder.
      token: 'session',
      onAuthenticationFailed: ({ reason }) => setState({ kind: 'denied', reason }),
    })
    const store = new SnapshotStore(project)
    const undo = new Y.UndoManager(project.roots, { trackedOrigins: new Set([origin]), captureTimeout: 600 })
    const value: ProjectContextValue = { projectId, doc, project, store, undo, provider }

    // Ready once the document has content, from this browser's copy or the server.
    const check = () => {
      if (project.mainCutId()) {
        doc.off('update', check)
        setState((s) => (s.kind === 'denied' ? s : { kind: 'ready', value }))
      }
    }
    doc.on('update', check)
    check()

    return () => {
      doc.off('update', check)
      undo.destroy()
      store.destroy()
      provider.destroy()
      void local.destroy()
      doc.destroy()
      setState({ kind: 'loading' })
    }
  }, [projectId, user.id])

  if (state.kind === 'denied') return <>{denied(state.reason)}</>
  if (state.kind === 'loading') return <>{loading}</>
  return <ProjectContext.Provider value={state.value}>{children}</ProjectContext.Provider>
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('useProjectContext must be used inside ProjectProvider')
  return value
}
