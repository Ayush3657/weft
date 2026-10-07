import { Check, Copy, FileText, FolderOpen, HardDrive, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { copyText } from '../lib/copy'
import { desktop, type DesktopInfo } from '../lib/desktop'
import { toastError } from '../lib/toast'
import { Button, Modal } from '../ui'

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex items-start gap-3 rounded-xl border border-line bg-bg p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-fg-2">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-medium text-fg">{title}</h3>
        {children}
      </div>
    </section>
  )
}

function Address({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[12px] text-fg">{url}</code>
      <Button
        size="sm"
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={() =>
          void copyText(url).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** The desktop app's settings: where the projects are kept, and opening Weft to the team. */
export function DesktopSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [restarting, setRestarting] = useState<string | null>(null)

  useEffect(() => {
    if (open && desktop) void desktop.info().then(setInfo).catch(toastError)
  }, [open])

  if (!desktop) return null
  const app = desktop
  // Weft restarts (and this page reloads) when the app says it's going to.
  const restartFor = async (why: string, ask: () => Promise<boolean>) => {
    try {
      if (await ask()) setRestarting(why)
    } catch (error) {
      toastError(error)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={600}
      title="This computer"
      description="Weft runs here in its own app, with its projects on this computer, so it works without a network."
    >
      {info && (
        <div className="flex flex-col gap-4">
          <Section icon={<HardDrive size={18} aria-hidden />} title="Projects">
            <p className="text-fg-2">Kept in this folder, with their pictures, clips and sound:</p>
            <code className="rounded-md border border-line bg-panel px-2 py-1 font-mono text-[12px] break-all text-fg">{info.dataDir}</code>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void app.openDataFolder()}>
                Show the folder
              </Button>
              <Button size="sm" busy={restarting === 'folder'} onClick={() => void restartFor('folder', () => app.chooseDataFolder())}>
                Use a different folder…
              </Button>
            </div>
            <p className="text-[12px] text-fg-3">
              Weft restarts with the projects in the folder you choose; the ones here stay where they are. To carry on with projects from Weft you ran another way (Start
              Weft.cmd), choose its data folder, and close that Weft first.
            </p>
          </Section>

          <Section icon={<Users size={18} aria-hidden />} title="Your team">
            <label className="flex cursor-pointer items-center gap-2 text-fg">
              <input
                type="checkbox"
                checked={info.shareWithTeam}
                disabled={!!restarting}
                onChange={(e) => {
                  const on = e.target.checked
                  void restartFor('share', () => app.shareWithTeam(on))
                }}
                className="size-3.5 accent-[var(--accent)]"
              />
              Open Weft to your team on this network
              {restarting === 'share' && <span className="text-fg-3">· restarting…</span>}
            </label>
            {info.shareWithTeam ? (
              info.teamUrl ? (
                <>
                  <p className="text-fg-2">Teammates open this in Chrome or Edge, and connect their Claude from there:</p>
                  <Address url={info.teamUrl} />
                </>
              ) : (
                <p className="text-fg-2">Weft couldn't find this computer's address on the network. Is it connected?</p>
              )
            ) : (
              <p className="text-fg-2">Teammates on the same network can then work in this Weft, with you, while this app is open.</p>
            )}
            <p className="text-[12px] text-fg-3">
              Sign-in is still a name and an email with no password, so anyone on the network can sign in as anyone: only do this on a network you trust. Windows may ask
              whether Weft can use the network; allow it on private networks.
            </p>
          </Section>

          <div className="flex items-center justify-between text-[12px] text-fg-3">
            <span>Weft {info.version}</span>
            <Button size="sm" variant="ghost" icon={<FileText size={14} />} onClick={() => void app.openLog()}>
              Open the server's log
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
