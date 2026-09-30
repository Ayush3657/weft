import { useSyncExternalStore } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()

function subscribe(listener: Listener) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function navigate(to: string, { replace = false } = {}): void {
  if (to === location.pathname + location.search) return
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  for (const listener of [...listeners]) listener()
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

export type Workspace = 'write' | 'board' | 'play'
export const WORKSPACES: readonly Workspace[] = ['write', 'board', 'play']

export type Route =
  | { name: 'projects' }
  | { name: 'project'; projectId: string; workspace: Workspace }
  | { name: 'not-found' }

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'projects' }
  const match = /^\/p\/([A-Za-z0-9]{6,32})(?:\/(write|board|play))?\/?$/.exec(pathname)
  if (match) return { name: 'project', projectId: match[1]!, workspace: (match[2] as Workspace | undefined) ?? 'board' }
  return { name: 'not-found' }
}

export const projectPath = (projectId: string, workspace: Workspace = 'board') => `/p/${projectId}/${workspace}`
