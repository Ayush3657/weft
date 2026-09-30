import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { readPref, writePref } from '../lib/prefs'
import { LogoMark } from '../shell/Shell'
import { Button, Field, Input } from '../ui'

export function LoginPage() {
  const { config, signInDev } = useAuth()
  const [name, setName] = useState(readPref('dev-name') ?? '')
  const [email, setEmail] = useState(readPref('dev-email') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signInDev(name.trim(), email.trim())
      writePref('dev-name', name.trim())
      writePref('dev-email', email.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-[360px]">
        <LogoMark size={40} />
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-fg">Sign in to Weft</h1>
        <p className="mt-1.5 text-[14px] text-fg-2">Storyboards for ads and films. You direct, AI assists.</p>

        {config.devLogin ? (
          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
            <Field label="Name" htmlFor="name">
              <Input id="name" autoFocus required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@company.com"
              />
            </Field>
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" busy={busy} className="mt-1 h-9">
              Continue
            </Button>
            <p className="text-[12px] text-fg-3">
              Local test sign-in: no password. Google and Microsoft sign-in come before team testing.
            </p>
          </form>
        ) : (
          <p className="mt-7 rounded-lg border border-line bg-panel p-4 text-fg-2">
            Sign-in isn't set up on this server yet. Ask whoever runs it to turn on Google or Microsoft sign-in.
          </p>
        )}
      </div>
    </div>
  )
}
