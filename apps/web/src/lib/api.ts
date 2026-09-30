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
}

export interface AuthConfig {
  devLogin: boolean
  providers: string[]
}
