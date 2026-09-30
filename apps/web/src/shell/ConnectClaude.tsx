import { Check, Copy, KeyRound, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cx } from '../lib/cx'
import { toastError } from '../lib/toast'
import { Button, IconButton, Modal, Segmented } from '../ui'

interface Setup {
  serverUrl: string
  connectorPath: string
  connectorBuilt: boolean
  nodePath: string
}

interface TokenInfo {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

type App = 'desktop' | 'code'

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }
  return (
    <div className="relative">
      <pre className="max-h-[220px] overflow-auto rounded-lg border border-line bg-bg p-3 pr-11 font-mono text-[11.5px] leading-[1.55] break-all whitespace-pre-wrap text-fg">
        {text}
      </pre>
      <IconButton size="sm" label={copied ? 'Copied' : `Copy ${label}`} onClick={copy} className="absolute top-1.5 right-1.5">
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </IconButton>
    </div>
  )
}

const when = (t: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'never')

/** Sets up Claude Desktop or Claude Code to work in Weft projects through MCP. */
export function ConnectClaude({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [app, setApp] = useState<App>('desktop')
  const [busy, setBusy] = useState(false)

  const loadTokens = () =>
    api<{ tokens: TokenInfo[] }>('/api/tokens')
      .then((r) => setTokens(r.tokens))
      .catch(toastError)

  useEffect(() => {
    if (!open) {
      setToken(null)
      return
    }
    api<Setup>('/api/connect').then(setSetup).catch(toastError)
    void loadTokens()
  }, [open])

  const create = async () => {
    setBusy(true)
    try {
      const { token: fresh } = await api<{ token: string }>('/api/tokens', {
        method: 'POST',
        body: { name: app === 'desktop' ? 'Claude Desktop' : 'Claude Code' },
      })
      setToken(fresh)
      await loadTokens()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await api(`/api/tokens/${id}`, { method: 'DELETE' })
      await loadTokens()
    } catch (error) {
      toastError(error)
    }
  }

  const key = token ?? 'weft_…'
  const desktop = setup
    ? JSON.stringify(
        { mcpServers: { weft: { command: setup.nodePath, args: [setup.connectorPath], env: { WEFT_URL: setup.serverUrl, WEFT_TOKEN: key } } } },
        null,
        2,
      )
    : ''
  const code = setup
    ? `claude mcp add weft --scope user --env WEFT_URL=${setup.serverUrl} --env WEFT_TOKEN=${key} -- "${setup.nodePath}" "${setup.connectorPath}"`
    : ''

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={620}
      title="Connect Claude"
      description="Claude can read your projects and board, write and retime them with you. Its edits show up live for everyone, and you can keep or undo them from the bar that appears."
    >
      <div className="flex flex-col gap-5">
        <Segmented<App>
          label="Claude app"
          options={[
            { id: 'desktop', label: 'Claude Desktop' },
            { id: 'code', label: 'Claude Code' },
          ]}
          value={app}
          onChange={(v) => v && setApp(v)}
        />

        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-fg">1. Make a key for Claude</h3>
          {token ? (
            <p className="text-[12px] text-warn">
              This key is shown once, and it's already in the settings below. Anyone who has it can edit your projects as you.
            </p>
          ) : (
            <p className="text-fg-2">Claude uses its own access key, so you can take its access away later without signing out.</p>
          )}
          {!token && (
            <Button className="self-start" variant="primary" icon={<KeyRound size={14} />} busy={busy} onClick={() => void create()}>
              Create a key
            </Button>
          )}
        </section>

        <section className={cx('flex flex-col gap-2', !token && 'opacity-60')}>
          {app === 'desktop' ? (
            <>
              <h3 className="font-medium text-fg">2. Add Weft to Claude Desktop</h3>
              <p className="text-fg-2">
                In Claude Desktop, open Settings, then Developer, then Edit Config. Add this to the file (if it already has{' '}
                <code className="rounded bg-hover px-1 font-mono text-[12px]">mcpServers</code>, add the{' '}
                <code className="rounded bg-hover px-1 font-mono text-[12px]">weft</code> entry to it), save, and restart Claude Desktop.
              </p>
              <CopyBlock text={desktop} label="settings" />
            </>
          ) : (
            <>
              <h3 className="font-medium text-fg">2. Add Weft to Claude Code</h3>
              <p className="text-fg-2">Run this once in a terminal:</p>
              <CopyBlock text={code} label="command" />
            </>
          )}
          {setup && !setup.connectorBuilt && (
            <p className="text-[12px] text-warn">
              The connector isn't built yet. Run <code className="font-mono">npm run build -w @weft/mcp</code> in the Weft folder (npm run dev does it too).
            </p>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="font-medium text-fg">3. Ask Claude</h3>
          <p className="text-fg-2">
            Try “List my Weft projects”, or “Board this script as a 30s ad in Skyline Towers”. Weft's ready-made prompts (board a
            script, write image prompts, fit a cut to a length, review the board) are in Claude's attach menu.
          </p>
        </section>

        {tokens.length > 0 && (
          <section className="flex flex-col gap-1 border-t border-line pt-4">
            <h3 className="mb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Keys you've made</h3>
            {tokens.map((t) => (
              <div key={t.id} className="flex h-8 items-center gap-3 text-[12px]">
                <KeyRound size={13} className="text-fg-3" aria-hidden />
                <span className="flex-1 text-fg">{t.name}</span>
                <span className="text-fg-3">made {when(t.createdAt)} · last used {when(t.lastUsedAt)}</span>
                <IconButton size="sm" label={`Revoke ${t.name}`} tooltip="Revoke: Claude loses access with this key" onClick={() => void revoke(t.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  )
}
