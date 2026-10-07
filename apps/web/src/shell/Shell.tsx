import { LogOut, Monitor, Moon, Sparkles, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAuth, useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { desktop } from '../lib/desktop'
import { useTheme } from '../lib/prefs'
import { navigate } from '../lib/router'
import { Avatar, Menu } from '../ui'
import { ConnectClaude } from './ConnectClaude'
import { DesktopSettings } from './DesktopSettings'

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--raised)" stroke="var(--line-strong)" />
      <path d="M6 11h20M6 16h20M6 21h20" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M9 7c2 3 2 5 0 9s-2 6 0 9M16 7c2 3 2 5 0 9s-2 6 0 9M23 7c2 3 2 5 0 9s-2 6 0 9"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Logo({ onClick }: { onClick?: () => void }) {
  const content = (
    <>
      <LogoMark />
      <span className="text-[14px] font-semibold tracking-tight text-fg">Weft</span>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-hover" aria-label="All projects">
      {content}
    </button>
  ) : (
    <span className="flex items-center gap-2">{content}</span>
  )
}

export function UserMenu() {
  const user = useUser()
  const { signOut } = useAuth()
  const [theme, setTheme] = useTheme()
  const [connecting, setConnecting] = useState(false)
  const [computer, setComputer] = useState(false)
  return (
    <>
      <Menu
        header={
          <div>
            <div className="font-medium text-fg">{user.name}</div>
            <div>{user.email}</div>
          </div>
        }
        trigger={
          <button type="button" className="rounded-full p-0.5 hover:bg-hover" aria-label="Account and settings">
            <Avatar name={user.name} />
          </button>
        }
        items={[
          { label: 'Connect Claude…', icon: <Sparkles size={14} />, onSelect: () => setConnecting(true) },
          ...(desktop ? [{ label: 'This computer…', icon: <Monitor size={14} />, onSelect: () => setComputer(true) }] : []),
          {
            label: theme === 'dark' ? 'Light theme' : 'Dark theme',
            icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
            onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
          },
          'separator',
          { label: 'Sign out', icon: <LogOut size={14} />, onSelect: () => void signOut() },
        ]}
      />
      <ConnectClaude open={connecting} onOpenChange={setConnecting} />
      <DesktopSettings open={computer} onOpenChange={setComputer} />
    </>
  )
}

export function AppHeader({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3', className)}>
      <Logo onClick={() => navigate('/')} />
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <UserMenu />
    </header>
  )
}
