export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface ProjectSummary {
  id: string
  title: string
  type: 'ad' | 'film' | 'other'
  createdAt: number
  updatedAt: number
  createdBy: { id: string; name: string } | null
  spaceId: string
  folderId: string | null
}

export type Role = 'owner' | 'member'

export interface SpaceSummary {
  id: string
  name: string
  kind: 'personal' | 'team'
  role: Role
  about: string
  members: number
  projects: number
}

export interface FolderInfo {
  id: string
  spaceId: string
  parentId: string | null
  name: string
  about: string
  createdAt: number
  updatedAt: number
}

export interface SpaceContents {
  space: SpaceSummary
  folders: FolderInfo[]
  projects: ProjectSummary[]
  /** Library items per folder id ('' for the space's top level). */
  libraryCounts: Record<string, number>
}

export interface MemberInfo {
  id: string
  name: string
  email: string
  role: Role
}

export interface LibraryItem {
  id: string
  spaceId: string
  folderId: string | null
  hash: string
  kind: 'image' | 'video' | 'audio'
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  caption: string
  tags: string[]
  /** Claude's suggestions, waiting for someone to keep or drop them. */
  suggestedTags: string[]
  addedBy: { id: string; name: string } | null
  addedAt: number
}

export interface LibraryLevel {
  spaceId: string
  folderId: string | null
  name: string
  about: string
  items: LibraryItem[]
}

export interface AuthConfig {
  devLogin: boolean
  providers: string[]
}
