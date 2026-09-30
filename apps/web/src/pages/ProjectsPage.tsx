import { ASPECT_RATIOS, PROJECT_DEFAULTS, type AspectRatio, type ProjectType } from '@weft/model'
import { Clapperboard, Film, MoreHorizontal, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type ProjectSummary } from '../lib/api'
import { navigate, projectPath } from '../lib/router'
import { toastError } from '../lib/toast'
import { AppHeader } from '../shell/Shell'
import { Button, Field, IconButton, Input, Menu, Modal, Segmented, Spinner } from '../ui'

const TYPE_LABELS: Record<ProjectType, string> = { ad: 'Ad', film: 'Short film', other: 'Other' }
const TYPE_ICONS = { ad: Sparkles, film: Film, other: Clapperboard }

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)

  const load = useCallback(() => {
    api<{ projects: ProjectSummary[] }>('/api/projects')
      .then((r) => {
        setProjects(r.projects)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load projects"))
  }, [])

  useEffect(load, [load])

  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight text-fg">Projects</h1>
              <p className="mt-1 text-fg-2">Everyone on this server can open these.</p>
            </div>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              New project
            </Button>
          </div>

          {error && (
            <div className="mt-8 flex items-center gap-3 rounded-lg border border-line bg-panel p-4 text-fg-2">
              <span className="flex-1">{error}</span>
              <Button size="sm" onClick={load}>
                Try again
              </Button>
            </div>
          )}
          {!error && projects === null && (
            <div className="mt-10">
              <Spinner label="Loading projects…" />
            </div>
          )}
          {projects?.length === 0 && (
            <div className="mt-10 flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
              <Clapperboard size={28} className="text-fg-3" aria-hidden />
              <h2 className="mt-3 text-[15px] font-semibold text-fg">Start your first project</h2>
              <p className="mt-1 max-w-sm text-fg-2">
                A project holds one ad or film: its script, its board of frames, and its cuts.
              </p>
              <Button className="mt-5" variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                New project
              </Button>
            </div>
          )}
          {projects && projects.length > 0 && (
            <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {projects.map((p) => {
                const Icon = TYPE_ICONS[p.type] ?? Clapperboard
                return (
                  <li key={p.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => navigate(projectPath(p.id))}
                      className="flex w-full flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong hover:bg-raised"
                    >
                      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                        <Icon size={17} aria-hidden />
                      </span>
                      <span className="mt-4 truncate pr-6 text-[14px] font-semibold text-fg">{p.title}</span>
                      <span className="mt-1 text-[12px] text-fg-3">
                        {TYPE_LABELS[p.type] ?? p.type} · edited {timeAgo(p.updatedAt)}
                        {p.createdBy ? ` · by ${p.createdBy.name}` : ''}
                      </span>
                    </button>
                    <div className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Menu
                        trigger={
                          <IconButton size="sm" label="Project options">
                            <MoreHorizontal size={15} />
                          </IconButton>
                        }
                        items={[{ label: 'Delete project', icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(p) }]}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </main>

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this project?"
        description={deleting ? `“${deleting.title}” will be removed for everyone on this server.` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={async () => {
              if (!deleting) return
              try {
                await api(`/api/projects/${deleting.id}`, { method: 'DELETE' })
                setDeleting(null)
                load()
              } catch (e) {
                toastError(e)
              }
            }}
          >
            Delete project
          </Button>
        </div>
      </Modal>
    </div>
  )
}

const TARGETS: Record<ProjectType, number[]> = { ad: [6, 15, 30, 60], film: [], other: [] }

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ProjectType>('ad')
  const [aspect, setAspect] = useState<AspectRatio>('16:9')
  const [target, setTarget] = useState<string>('30')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setType('ad')
    setAspect('16:9')
    setTarget('30')
  }, [open])

  const chooseType = (next: ProjectType) => {
    setType(next)
    setAspect(PROJECT_DEFAULTS[next].aspect)
    const seconds = PROJECT_DEFAULTS[next].targetDuration
    setTarget(seconds === null ? '' : String(seconds))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const seconds = target.trim() ? Number(target) * (type === 'film' ? 60 : 1) : null
    setBusy(true)
    try {
      const { project } = await api<{ project: ProjectSummary }>('/api/projects', {
        method: 'POST',
        body: {
          title: title.trim(),
          type,
          aspect,
          targetDuration: seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
        },
      })
      onOpenChange(false)
      navigate(projectPath(project.id))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New project" width={480}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Title" htmlFor="project-title">
          <Input
            id="project-title"
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Skyline Towers launch"
          />
        </Field>
        <Field label="Type">
          <Segmented<ProjectType>
            label="Project type"
            options={[
              { id: 'ad', label: 'Ad' },
              { id: 'film', label: 'Short film' },
              { id: 'other', label: 'Other' },
            ]}
            value={type}
            onChange={(v) => v && chooseType(v)}
          />
        </Field>
        <Field label="Format">
          <Segmented<AspectRatio>
            label="Aspect ratio"
            options={ASPECT_RATIOS.map((a) => ({
              id: a,
              label: a,
              title: a === '9:16' ? 'Vertical (Reels, Shorts)' : a === '2.39:1' ? 'Cinemascope' : undefined,
            }))}
            value={aspect}
            onChange={(v) => v && setAspect(v)}
          />
        </Field>
        <Field label={type === 'film' ? 'Target length (minutes)' : 'Target length (seconds)'} hint="Optional">
          <div className="flex items-center gap-2">
            {TARGETS[type].length > 0 && (
              <Segmented<string>
                label="Common lengths"
                options={TARGETS[type].map((t) => ({ id: String(t), label: `${t}s` }))}
                value={TARGETS[type].map(String).includes(target) ? target : null}
                onChange={(v) => setTarget(v ?? '')}
              />
            )}
            <Input
              aria-label="Target length"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={type === 'film' ? '30' : 'None'}
              className="w-24"
            />
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!title.trim()}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  )
}
