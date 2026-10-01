import { Check, CheckCircle2, Copy, KeyRound, Laptop, Plug, Trash2, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cx } from '../lib/cx'
import { toast, toastError } from '../lib/toast'
import { Button, IconButton, Modal, Segmented } from '../ui'

interface Setup {
  serverUrl: string
  connectorPath: string
  connectorBuilt: boolean
  nodePath: string
  here: { available: false } | { available: true; connected: boolean; desktopFound: boolean; desktopHasWeft: boolean }
}

interface TokenInfo {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

interface ConfigChange {
  updated: string[]
  failed: Array<{ file: string; reason: string }>
}

type Where = 'here' | 'elsewhere'
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
  const [where, setWhere] = useState<Where>('here')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ desktopFound: boolean; desktop: ConfigChange } | null>(null)

  const load = () =>
    Promise.all([api<Setup>('/api/connect'), api<{ tokens: TokenInfo[] }>('/api/tokens')])
      .then(([s, t]) => {
        setSetup(s)
        setTokens(t.tokens)
        return s
      })
      .catch(toastError)

  useEffect(() => {
    if (!open) {
      setResult(null)
      return
    }
    void load().then((s) => s && setWhere(s.here.available ? 'here' : 'elsewhere'))
  }, [open])

  const connectHere = async () => {
    setBusy(true)
    try {
      setResult(await api<{ desktopFound: boolean; desktop: ConfigChange }>('/api/connect/local', { method: 'POST' }))
      await load()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const disconnectHere = async () => {
    setBusy(true)
    try {
      await api('/api/connect/local', { method: 'DELETE' })
      setResult(null)
      await load()
      toast('Claude on this computer is disconnected.', 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await api(`/api/tokens/${id}`, { method: 'DELETE' })
      await load()
    } catch (error) {
      toastError(error)
    }
  }

  const here = setup?.here.available ? setup.here : null

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={620}
      title="Connect Claude"
      description="Claude can read your projects and board, write and retime them with you. Its edits show up live for everyone, and you can keep or undo them from the bar that appears."
    >
      <div className="flex flex-col gap-5">
        {here && (
          <Segmented<Where>
            label="Where Claude runs"
            options={[
              { id: 'here', label: 'On this computer' },
              { id: 'elsewhere', label: 'On another computer' },
            ]}
            value={where}
            onChange={(v) => v && setWhere(v)}
          />
        )}

        {where === 'here' && here && setup ? (
          <HereSetup
            setup={setup}
            here={here}
            busy={busy}
            result={result}
            onConnect={() => void connectHere()}
            onDisconnect={() => void disconnectHere()}
          />
        ) : (
          setup && <ElsewhereSetup setup={setup} onKeyMade={() => void load()} />
        )}

        {tokens.length > 0 && (
          <section className="flex flex-col gap-1 border-t border-line pt-4">
            <h3 className="mb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">Keys Claude uses</h3>
            {tokens.map((t) => (
              <div key={t.id} className="flex h-8 items-center gap-3 text-[12px]">
                <KeyRound size={13} className="text-fg-3" aria-hidden />
                <span className="flex-1 text-fg">{t.name}</span>
                <span className="text-fg-3">
                  made {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </span>
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

function HereSetup({
  setup,
  here,
  busy,
  result,
  onConnect,
  onDisconnect,
}: {
  setup: Setup
  here: { connected: boolean; desktopFound: boolean; desktopHasWeft: boolean }
  busy: boolean
  result: { desktopFound: boolean; desktop: ConfigChange } | null
  onConnect: () => void
  onDisconnect: () => void
}) {
  const code = `claude mcp add weft --scope user -- "${setup.nodePath}" "${setup.connectorPath}"`
  return (
    <div className="flex flex-col gap-4">
      <section className="flex items-start gap-3 rounded-xl border border-line bg-bg p-4">
        <span
          className={cx(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            here.connected ? 'bg-accent-soft text-accent-strong' : 'bg-hover text-fg-2',
          )}
        >
          {here.connected ? <CheckCircle2 size={18} aria-hidden /> : <Laptop size={18} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">
            {here.connected ? 'Claude on this computer is connected to your account' : 'Connect Claude on this computer in one click'}
          </p>
          <p className="mt-0.5 text-fg-2">
            {here.connected
              ? `Claude Desktop${here.desktopHasWeft ? ' has Weft in its settings' : " doesn't have Weft in its settings yet"}. Connecting again makes a new key and replaces the old one.`
              : "Weft makes a key for Claude (you can revoke it here), saves it in your user folder where the Weft connector finds it, and adds Weft to Claude Desktop's settings. The key never goes into Claude's settings."}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant={here.connected ? 'secondary' : 'primary'} icon={<Plug size={14} />} busy={busy} onClick={onConnect}>
              {here.connected ? 'Connect again' : 'Connect Claude on this computer'}
            </Button>
            {here.connected && (
              <Button variant="ghost" icon={<Unplug size={14} />} disabled={busy} onClick={onDisconnect}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </section>

      {result && (
        <section className="flex flex-col gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3">
          <p className="font-medium text-fg">Connected. Now restart Claude Desktop.</p>
          {result.desktop.updated.length > 0 && <p className="text-fg-2">Weft is in Claude Desktop's settings.</p>}
          {!result.desktopFound && <p className="text-fg-2">Claude Desktop isn't installed here, so only Claude Code is set up.</p>}
          {result.desktop.failed.map((f) => (
            <p key={f.file} className="text-[12px] text-warn">
              Couldn't change {f.file}: {f.reason}. Use “On another computer” to set it up by hand.
            </p>
          ))}
        </section>
      )}

      {(here.connected || result) && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-fg">Then</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-fg-2">
            <li>
              Quit Claude Desktop fully and open it again: it keeps running in the background when you close its window, so use Quit
              from its icon by the clock (or Ctrl+Q).
            </li>
            <li>In a new chat, check that Weft appears under the tools button, then ask “List my Weft projects”.</li>
            <li>Weft's ready-made prompts (board a script, write image prompts, fit a cut, review the board) are in the attach menu.</li>
          </ol>
          <p className="mt-1 text-[12px] text-fg-3">
            Claude Code: sessions opened in the Weft folder offer Weft by themselves. To have it in every folder, run this once:
          </p>
          <CopyBlock text={code} label="command" />
        </section>
      )}

      {!setup.connectorBuilt && (
        <p className="text-[12px] text-warn">
          The connector isn't built yet. Run <code className="font-mono">npm run build -w @weft/mcp</code> in the Weft folder (npm run dev does it
          too).
        </p>
      )}
    </div>
  )
}

function ElsewhereSetup({ setup, onKeyMade }: { setup: Setup; onKeyMade: () => void }) {
  const [app, setApp] = useState<App>('desktop')
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const { token: fresh } = await api<{ token: string }>('/api/tokens', {
        method: 'POST',
        body: { name: app === 'desktop' ? 'Claude Desktop' : 'Claude Code' },
      })
      setToken(fresh)
      onKeyMade()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const key = token ?? 'weft_…'
  const desktop = JSON.stringify(
    { mcpServers: { weft: { command: 'node', args: ['C:\\path\\to\\weft-mcp.mjs'], env: { WEFT_URL: setup.serverUrl, WEFT_TOKEN: key } } } },
    null,
    2,
  )
  const code = `claude mcp add weft --scope user --env WEFT_URL=${setup.serverUrl} --env WEFT_TOKEN=${key} -- node "C:\\path\\to\\weft-mcp.mjs"`

  return (
    <div className="flex flex-col gap-5">
      <p className="text-fg-2">
        Copy the connector, <code className="font-mono text-[12px]">apps/mcp/dist/weft-mcp.mjs</code>, to the other computer (it needs Node 20 or
        newer), and make sure that computer can reach this Weft server at {setup.serverUrl}.
      </p>
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
          <p className="text-[12px] text-warn">This key is shown once, and it's already in the settings below. Anyone who has it can edit your projects as you.</p>
        ) : (
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
              In Claude Desktop, open Settings, then Developer, then Edit Config. Add this (with the connector's real path), save, and restart
              Claude Desktop.
            </p>
            <CopyBlock text={desktop} label="settings" />
          </>
        ) : (
          <>
            <h3 className="font-medium text-fg">2. Add Weft to Claude Code</h3>
            <p className="text-fg-2">Run this once in a terminal, with the connector's real path:</p>
            <CopyBlock text={code} label="command" />
          </>
        )}
      </section>
    </div>
  )
}
