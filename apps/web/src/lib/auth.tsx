import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type AuthConfig, type User } from './api'
import { navigate } from './router'

interface AuthValue {
  status: 'loading' | 'unreachable' | 'signed-out' | 'signed-in'
  user: User | null
  config: AuthConfig
  retry(): void
  signInDev(name: string, email: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [config, setConfig] = useState<AuthConfig>({ devLogin: false, providers: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const cfg = await api<AuthConfig>('/api/auth/config')
        const me = await api<{ user: User }>('/api/me').catch(() => ({ user: null }))
        if (cancelled) return
        setConfig(cfg)
        setUser(me.user)
        setStatus(me.user ? 'signed-in' : 'signed-out')
      } catch {
        if (cancelled) return
        setStatus('unreachable')
        // Keep trying quietly, so the app recovers by itself once the server is up.
        timer = setTimeout(() => void load(), 3000)
      }
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [attempt])

  const retry = useCallback(() => {
    setStatus('loading')
    setAttempt((n) => n + 1)
  }, [])

  const signInDev = useCallback(async (name: string, email: string) => {
    const result = await api<{ user: User }>('/api/auth/dev', { method: 'POST', body: { name, email } })
    setUser(result.user)
    setStatus('signed-in')
  }, [])

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setStatus('signed-out')
    navigate('/', { replace: true })
  }, [])

  const value = useMemo(
    () => ({ status, user, config, retry, signInDev, signOut }),
    [status, user, config, retry, signInDev, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

/** The signed-in user. Only use below the sign-in gate. */
export function useUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('No signed-in user')
  return user
}
