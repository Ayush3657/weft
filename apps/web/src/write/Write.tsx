import { Project, byCreation, cutTimeline, type PageSnapshot } from '@weft/model'
import { BookOpen, Clapperboard, FileText, NotebookPen, Palette, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import { focusSoon } from '../lib/focus'
import { usePref } from '../lib/prefs'
import { navigate, writePath, type WriteLocation } from '../lib/router'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, ContextMenuArea, IconButton, Modal, Spinner } from '../ui'
import { Bible } from './Bible'
import { Moodboard } from './Moodboard'
import { Notes } from './Notes'
import { Script } from './Script'

const serialize = (l: WriteLocation) => (l.section === 'notes' && l.pageId ? `notes/${l.pageId}` : l.section)

function deserialize(raw: string | null): WriteLocation | null {
  if (!raw) return null
  const [section, pageId] = raw.split('/')
  if (section === 'notes') return { section, pageId: pageId ?? null }
  if (section === 'script' || section === 'bible' || section === 'moodboard') return { section, pageId: null }
  return null
}

/** Notes, the AV script, the bible and the moodboard. */
export function Write({ location, cutId }: { location: WriteLocation | null; cutId: string }) {
  const s = useSnapshot()
  const { projectId, doc } = useProjectContext()
  const [saved, setSaved] = usePref(`write:${projectId}`)
  const current = location ?? deserialize(saved) ?? { section: 'notes', pageId: null }
  const key = serialize(current)

  // Reopen Write where you left it.
  useEffect(() => {
    if (location) setSaved(key)
  }, [location, key, setSaved])

  // Projects made before notes pages existed get their first page, outside undo history.
  const hasPages = Object.keys(s.pages).length > 0
  useEffect(() => {
    if (!hasPages) new Project(doc, { source: 'system' }).ensureNotesPage()
  }, [hasPages, doc])

  const pages = Object.values(s.pages).sort(byCreation)
  const pageId =
    current.section === 'notes' ? (current.pageId && s.pages[current.pageId] ? current.pageId : (pages[0]?.id ?? null)) : null

  return (
    <div className="flex h-full min-h-0">
      <Sidebar current={current} pageId={pageId} pages={pages} cutId={cutId} />
      <div className="min-w-0 flex-1">
        {current.section === 'notes' &&
          (pageId ? (
            <Notes key={pageId} pageId={pageId} cutId={cutId} isFirst={pageId === pages[0]?.id} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ))}
        {current.section === 'script' && <Script cutId={cutId} />}
        {current.section === 'bible' && <Bible />}
        {current.section === 'moodboard' && <Moodboard cutId={cutId} />}
      </div>
    </div>
  )
}

function Item({
  icon: Icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors',
        active ? 'bg-active font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
      )}
    >
      <Icon size={15} className={active ? 'text-accent-strong' : 'text-fg-3'} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="text-[11px] text-fg-3 tabular-nums">{count}</span>}
    </button>
  )
}

function Sidebar({
  current,
  pageId,
  pages,
  cutId,
}: {
  current: WriteLocation
  pageId: string | null
  pages: PageSnapshot[]
  cutId: string
}) {
  const s = useSnapshot()
  const project = useProject()
  const { projectId } = useProjectContext()
  const [deleting, setDeleting] = useState<PageSnapshot | null>(null)
  const go = (l: WriteLocation) => navigate(writePath(projectId, l))
  const [first, ...rest] = pages
  const rows = cutTimeline(s, cutId).items.length

  const newPage = () => {
    const id = project.createPage('')
    focusSoon(`[data-page-title="${id}"]`)
    go({ section: 'notes', pageId: id })
  }

  return (
    <nav aria-label="Write" className="flex w-[216px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel p-2">
      <Item
        icon={NotebookPen}
        label={first?.title || 'Notes'}
        active={current.section === 'notes' && pageId === first?.id}
        onClick={() => go({ section: 'notes', pageId: null })}
      />
      <Item icon={Clapperboard} label="Script" count={rows} active={current.section === 'script'} onClick={() => go({ section: 'script', pageId: null })} />
      <Item
        icon={BookOpen}
        label="Bible"
        count={Object.keys(s.bible).length}
        active={current.section === 'bible'}
        onClick={() => go({ section: 'bible', pageId: null })}
      />
      <Item
        icon={Palette}
        label="Moodboard"
        count={Object.keys(s.moodboard).length}
        active={current.section === 'moodboard'}
        onClick={() => go({ section: 'moodboard', pageId: null })}
      />

      <div className="mt-4 mb-0.5 flex h-7 items-center justify-between pr-0.5 pl-2.5">
        <span className="text-[11px] font-medium tracking-wide text-fg-3 uppercase">Pages</span>
        <IconButton size="sm" label="New page" onClick={newPage}>
          <Plus size={15} />
        </IconButton>
      </div>
      {rest.map((page) => (
        <ContextMenuArea
          key={page.id}
          items={[{ label: 'Delete page', icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(page) }]}
        >
          <div className="group relative">
            <Item
              icon={FileText}
              label={page.title || 'Untitled'}
              active={current.section === 'notes' && pageId === page.id}
              onClick={() => go({ section: 'notes', pageId: page.id })}
            />
            <IconButton
              size="sm"
              label="Delete page"
              onClick={() => setDeleting(page)}
              className="absolute top-0.5 right-0.5 size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
        </ContextMenuArea>
      ))}
      {rest.length === 0 && (
        <button type="button" onClick={newPage} className="rounded-md px-2.5 py-1.5 text-left text-[12px] text-fg-3 hover:bg-hover hover:text-fg-2">
          Research, client feedback, shot ideas: add a page for anything.
        </button>
      )}

      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.title || 'Untitled'}”?`}
        description="It goes for everyone working on the project. Ctrl+Z brings it back; its pictures and links stay in the Library."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (!deleting) return
              project.deletePage(deleting.id)
              if (pageId === deleting.id) go({ section: 'notes', pageId: null })
              setDeleting(null)
            }}
          >
            Delete page
          </Button>
        </div>
      </Modal>
    </nav>
  )
}
