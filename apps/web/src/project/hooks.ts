import type { Project, ProjectSnapshot } from '@weft/model'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useProjectContext } from './ProjectProvider'

export function useProject(): Project {
  return useProjectContext().project
}

export function useSnapshot(): ProjectSnapshot {
  const { store } = useProjectContext()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export type SyncStatus = 'connecting' | 'saving' | 'saved' | 'offline'

export function useSyncStatus(): SyncStatus {
  const { provider } = useProjectContext()
  const [status, setStatus] = useState<SyncStatus>('connecting')

  useEffect(() => {
    // The socket state only arrives through events, so track it here.
    let socket: 'connecting' | 'connected' | 'disconnected' = 'connecting'
    const update = () => {
      if (socket === 'disconnected') setStatus('offline')
      else if (!provider.isSynced) setStatus('connecting')
      else setStatus(provider.hasUnsyncedChanges ? 'saving' : 'saved')
    }
    const onStatus = ({ status: next }: { status: typeof socket }) => {
      socket = next
      update()
    }
    provider.on('status', onStatus)
    provider.on('synced', update)
    provider.on('unsyncedChanges', update)
    update()
    return () => {
      provider.off('status', onStatus)
      provider.off('synced', update)
      provider.off('unsyncedChanges', update)
    }
  }, [provider])

  return status
}

export function useUndoRedo() {
  const { undo } = useProjectContext()
  const subscribe = useCallback(
    (listener: () => void) => {
      const events = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const
      for (const e of events) undo.on(e, listener)
      return () => {
        for (const e of events) undo.off(e, listener)
      }
    },
    [undo],
  )
  const canUndo = useSyncExternalStore(subscribe, () => undo.canUndo())
  const canRedo = useSyncExternalStore(subscribe, () => undo.canRedo())
  return {
    canUndo,
    canRedo,
    undo: useCallback(() => void undo.undo(), [undo]),
    redo: useCallback(() => void undo.redo(), [undo]),
  }
}

/** Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo, everywhere in the project (text included). */
export function useUndoShortcuts(): void {
  const { undo } = useProjectContext()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo.undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        undo.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])
}
