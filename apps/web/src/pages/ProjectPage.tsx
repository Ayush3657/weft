import { cutTimeline, formatSeconds } from '@weft/model'
import { Check, ChevronDown, CloudOff, Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Board } from '../board/Board'
import { cx } from '../lib/cx'
import { usePref } from '../lib/prefs'
import { navigate, projectPath, type Workspace } from '../lib/router'
import { useProject, useSnapshot, useSyncStatus, useUndoShortcuts } from '../project/hooks'
import { ProjectProvider } from '../project/ProjectProvider'
import { AppHeader } from '../shell/Shell'
import { Button, Field, FullScreenMessage, Input, Menu, Modal, Spinner } from '../ui'
import { WorkspacePlaceholder } from './WorkspacePlaceholder'

export function ProjectPage({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  return (
    <ProjectProvider
      key={projectId}
      projectId={projectId}
      loading={
        <FullScreenMessage>
          <Spinner label="Opening project…" />
        </FullScreenMessage>
      }
      denied={(reason) => (
        <FullScreenMessage>
          <div className="max-w-sm">
            <h1 className="text-[16px] font-semibold text-fg">This project isn't available</h1>
            <p className="mt-1.5 text-fg-2">
              {reason === 'Project not found' ? 'It may have been deleted.' : 'You may need to sign in again.'}
            </p>
            <Button className="mt-4" onClick={() => navigate('/')}>
              All projects
            </Button>
          </div>
        </FullScreenMessage>
      )}
    >
      <ProjectShell projectId={projectId} workspace={workspace} />
    </ProjectProvider>
  )
}

function ProjectShell({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const s = useSnapshot()
  const [savedCut, setSavedCut] = usePref(`cut:${projectId}`)
  const cutId = savedCut && s.cuts[savedCut] ? savedCut : s.meta.mainCutId
  useUndoShortcuts()

  useEffect(() => {
    document.title = `${s.meta.title || 'Untitled'} · Weft`
    return () => {
      document.title = 'Weft'
    }
  }, [s.meta.title])

  return (
    <div className="flex h-full flex-col">
      <AppHeader>
        <TitleField />
        <nav className="mx-auto flex items-center gap-0.5 rounded-lg bg-bg p-0.5" aria-label="Workspaces">
          {(['write', 'board', 'play'] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => navigate(projectPath(projectId, w))}
              aria-current={w === workspace ? 'page' : undefined}
              className={cx(
                'h-7 rounded-md px-3.5 text-[13px] font-medium capitalize transition-colors',
                w === workspace ? 'bg-raised text-fg shadow-sm' : 'text-fg-2 hover:text-fg',
              )}
            >
              {w}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <CutPicker cutId={cutId} onChange={setSavedCut} />
          <LengthMeter cutId={cutId} />
          <SyncIndicator />
        </div>
      </AppHeader>
      <main className="min-h-0 flex-1">
        {workspace === 'board' && <Board cutId={cutId} />}
        {workspace === 'write' && <WorkspacePlaceholder workspace="write" projectId={projectId} />}
        {workspace === 'play' && <WorkspacePlaceholder workspace="play" projectId={projectId} />}
      </main>
    </div>
  )
}

function TitleField() {
  const s = useSnapshot()
  const project = useProject()
  const [draft, setDraft] = useState(s.meta.title)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(s.meta.title)
  }, [s.meta.title])
  const commit = () => {
    const title = draft.trim()
    if (title && title !== s.meta.title) project.updateMeta({ title })
    else setDraft(s.meta.title)
  }
  return (
    <input
      aria-label="Project title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(s.meta.title)
          e.currentTarget.blur()
        }
      }}
      className="h-8 w-[min(260px,28vw)] truncate rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-fg hover:border-line focus:border-accent focus:bg-bg focus:outline-none"
    />
  )
}

function CutPicker({ cutId, onChange }: { cutId: string; onChange: (cutId: string | null) => void }) {
  const s = useSnapshot()
  const project = useProject()
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const cuts = Object.values(s.cuts).sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : a.createdAt - b.createdAt))
  const current = s.cuts[cutId]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (dialog === 'new') onChange(project.createCut(trimmed, { copyFrom: cutId }))
    else project.renameCut(cutId, trimmed)
    setDialog(null)
  }

  return (
    <>
      <Menu
        header="Cuts are versions of the film, each taking its own path through the board."
        trigger={
          <Button size="sm" variant="secondary" className="max-w-[200px]">
            <span className="truncate">{current?.name ?? 'Main cut'}</span>
            <ChevronDown size={14} className="shrink-0 text-fg-3" aria-hidden />
          </Button>
        }
        items={[
          ...cuts.map((c) => ({ label: c.name, checked: c.id === cutId, onSelect: () => onChange(c.id) })),
          'separator' as const,
          {
            label: 'New cut from this one',
            icon: <Copy size={14} />,
            onSelect: () => {
              setName(`${current?.name ?? 'Cut'} copy`)
              setDialog('new')
            },
          },
          {
            label: 'Rename cut',
            icon: <Pencil size={14} />,
            onSelect: () => {
              setName(current?.name ?? '')
              setDialog('rename')
            },
          },
          {
            label: 'Delete cut',
            icon: <Trash2 size={14} />,
            danger: true,
            disabled: !current || current.isMain,
            onSelect: () => {
              project.deleteCut(cutId)
              onChange(null)
            },
          },
        ]}
      />
      <Modal
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === 'new' ? 'New cut' : 'Rename cut'}
        description={dialog === 'new' ? 'Starts as a copy of the current cut: same path, hidden frames and lengths.' : undefined}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="cut-name">
            <Input id="cut-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="15s cutdown" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="submit" variant="primary" icon={dialog === 'new' ? <Plus size={14} /> : undefined} disabled={!name.trim()}>
              {dialog === 'new' ? 'Create cut' : 'Rename'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function LengthMeter({ cutId }: { cutId: string }) {
  const s = useSnapshot()
  const cut = s.cuts[cutId]
  const total = cutTimeline(s, cutId).total
  const target = cut?.targetDuration ?? null
  const over = target !== null && total > target + 0.05
  const ratio = target ? Math.min(1, total / target) : 0
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 text-[12px] tabular-nums"
      title={target ? `This cut runs ${formatSeconds(total)} of a ${formatSeconds(target)} target` : 'Length of this cut'}
    >
      <span className={over ? 'font-medium text-warn' : 'text-fg'}>{formatSeconds(total)}</span>
      {target !== null && (
        <>
          <span className="h-1 w-14 overflow-hidden rounded-full bg-line">
            <span className={cx('block h-full rounded-full', over ? 'bg-warn' : 'bg-accent')} style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="text-fg-3">{formatSeconds(target)}</span>
        </>
      )}
    </div>
  )
}

function SyncIndicator() {
  const status = useSyncStatus()
  const label = {
    connecting: 'Connecting…',
    saving: 'Saving…',
    saved: 'Saved',
    offline: 'Offline. Changes are kept on this device.',
  }[status]
  return (
    <span
      className={cx(
        'flex size-8 items-center justify-center rounded-md',
        status === 'offline' ? 'text-warn' : status === 'saved' ? 'text-fg-3' : 'text-fg-2',
      )}
      title={label}
      aria-label={label}
      role="status"
    >
      {status === 'offline' ? (
        <CloudOff size={15} />
      ) : status === 'saved' ? (
        <Check size={15} />
      ) : (
        <Loader2 size={15} className="animate-spin" />
      )}
    </span>
  )
}
