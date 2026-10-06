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

/** The current path and query string. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search)
}

export type Workspace = 'write' | 'board' | 'play'
export const WORKSPACES: readonly Workspace[] = ['write', 'board', 'play']

export type WriteSection = 'notes' | 'script' | 'bible' | 'moodboard'
export const WRITE_SECTIONS: readonly WriteSection[] = ['notes', 'script', 'bible', 'moodboard']

/** Where you are in Write: a section, and for notes, which page (null for the first). */
export interface WriteLocation {
  section: WriteSection
  pageId: string | null
}

/** On the projects page: a space's top level or one of its folders, showing its storyboards or its library. */
export interface ProjectsLocation {
  /** Null: wherever you were last. */
  spaceId: string | null
  folderId: string | null
  tab: 'storyboards' | 'library'
}

export type Route =
  | ({ name: 'projects' } & ProjectsLocation)
  | {
      name: 'project'
      projectId: string
      workspace: Workspace
      /** Set when the URL names a Write section; otherwise Write reopens where you left it. */
      write: WriteLocation | null
      /** Opened as a separate window (the moodboard on a second screen). */
      popout: boolean
    }
  | { name: 'not-found' }

const PROJECT_PATH =
  /^\/p\/([A-Za-z0-9]{6,32})(?:\/(write|board|play)(?:\/(notes|script|bible|moodboard)(?:\/([A-Za-z0-9_-]{1,40}))?)?)?\/?$/

const SPACE_PATH = /^\/s\/([A-Za-z0-9]{6,32})(?:\/f\/([A-Za-z0-9]{6,32}))?(\/library)?\/?$/

export function parseRoute(url: string): Route {
  const [pathname = '', search = ''] = url.split('?')
  if (pathname === '/' || pathname === '') return { name: 'projects', spaceId: null, folderId: null, tab: 'storyboards' }
  const space = SPACE_PATH.exec(pathname)
  if (space) return { name: 'projects', spaceId: space[1]!, folderId: space[2] ?? null, tab: space[3] ? 'library' : 'storyboards' }
  const match = PROJECT_PATH.exec(pathname)
  if (!match) return { name: 'not-found' }
  const [, projectId, workspace, section, pageId] = match
  if (pageId && section !== 'notes') return { name: 'not-found' }
  return {
    name: 'project',
    projectId: projectId!,
    workspace: (workspace as Workspace | undefined) ?? 'board',
    write: section ? { section: section as WriteSection, pageId: pageId ?? null } : null,
    popout: new URLSearchParams(search).get('window') === '1',
  }
}

export const projectPath = (projectId: string, workspace: Workspace = 'board') => `/p/${projectId}/${workspace}`

export function writePath(projectId: string, { section, pageId }: WriteLocation): string {
  return `/p/${projectId}/write/${section}${section === 'notes' && pageId ? `/${pageId}` : ''}`
}

export const spacePath = (spaceId: string, folderId: string | null = null, tab: ProjectsLocation['tab'] = 'storyboards') =>
  `/s/${spaceId}${folderId ? `/f/${folderId}` : ''}${tab === 'library' ? '/library' : ''}`
