import { shotLabels } from '@weft/model'
import { Check, ChevronDown, ChevronUp, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { revealOnBoard } from '../board/actions'
import { ApiError, api } from '../lib/api'
import { useUser } from '../lib/auth'
import { navigate, projectPath } from '../lib/router'
import { toast, toastError } from '../lib/toast'
import { Button } from '../ui'
import { useProject, useSnapshot } from './hooks'
import { useProjectContext } from './ProjectProvider'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Claude's edits, waiting for someone to keep or undo them. */
export function ChangeBar() {
  const s = useSnapshot()
  const project = useProject()
  const me = useUser()
  const { projectId } = useProjectContext()
  const [reviewing, setReviewing] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const open = Object.values(s.changes)
    .filter((c) => c.status === 'open')
    .sort((a, b) => a.startedAt - b.startedAt)

  // Undo history lives in the server's memory; after a restart, say so rather than offer an undo that fails.
  const claimed = open
    .filter((c) => c.undoable)
    .map((c) => c.id)
    .join(',')
  useEffect(() => {
    if (!claimed) return
    let cancelled = false
    api<{ live: string[] }>(`/api/projects/${projectId}/changes/live`)
      .then(({ live }) => {
        if (cancelled) return
        const stale = claimed.split(',').filter((id) => !live.includes(id))
        if (stale.length) project.transact(() => stale.forEach((id) => project.setChangeUndoable(id, false)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [claimed, projectId, project])

  if (!open.length) return null
  const edits = open.reduce((n, c) => n + c.summary.length, 0)
  const frames = [...new Set(open.flatMap((c) => c.frameIds))].filter((id) => s.frames[id])
  const undoable = open.filter((c) => c.undoable)
  const undoableEdits = undoable.reduce((n, c) => n + c.summary.length, 0)
  const latest = open.at(-1)!
  const labels = shotLabels(s)
  const forWhom = latest.userId && latest.userId !== me.id ? ` for ${latest.userName}` : ''

  const keep = () => project.transact(() => open.forEach((c) => project.setChangeStatus(c.id, 'kept')))

  const undo = async () => {
    setUndoing(true)
    try {
      // Newest first, the reverse of how they were made.
      for (const c of [...undoable].reverse()) {
        try {
          await api(`/api/projects/${projectId}/changes/${c.id}/undo`, { method: 'POST' })
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) project.setChangeUndoable(c.id, false)
          throw error
        }
      }
      toast(`Undid ${latest.agent}'s changes.`, 'ok')
      setReviewing(false)
    } catch (error) {
      toastError(error)
    } finally {
      setUndoing(false)
    }
  }

  const show = (frameId: string) => {
    revealOnBoard(frameId)
    navigate(projectPath(projectId, 'board'))
  }

  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex h-10 items-center gap-2 bg-accent-soft px-4" role="status">
        <Sparkles size={15} className="shrink-0 text-accent-strong" aria-hidden />
        <span className="truncate text-fg">
          <span className="font-medium">{latest.agent}</span> made {plural(edits, 'change')}
          {frames.length ? ` to ${plural(frames.length, 'frame')}` : ''}
          {forWhom}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setReviewing((r) => !r)}
          aria-expanded={reviewing}
          icon={reviewing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        >
          Review
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" icon={<Check size={14} />} onClick={keep}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 size={14} />}
            busy={undoing}
            disabled={!undoable.length}
            title={undoable.length ? `Undo everything ${latest.agent} changed here; your own edits stay` : `${latest.agent}'s session has ended, so these can't be undone here. Ask ${latest.agent} to change them back.`}
            onClick={() => void undo()}
          >
            {undoable.length && undoable.length < open.length ? `Undo ${undoableEdits} of ${edits}` : 'Undo all'}
          </Button>
        </div>
      </div>
      {reviewing && (
        <div className="max-h-[38vh] overflow-y-auto bg-panel px-4 py-3">
          {open.map((c) => (
            <div key={c.id} className="mb-3 last:mb-0">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
                {time(c.startedAt)}
                {c.updatedAt - c.startedAt > 60_000 ? `–${time(c.updatedAt)}` : ''}
                {c.userName ? ` · for ${c.userId === me.id ? 'you' : c.userName}` : ''}
                {!c.undoable ? ' · can no longer be undone here' : ''}
              </div>
              <ul className="flex flex-col gap-0.5">
                {c.summary.map((line, i) => (
                  <li key={i} className="text-fg-2">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {frames.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
              <span className="mr-1 text-[12px] text-fg-3">Show on the board</span>
              {frames.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => show(id)}
                  title={s.frames[id]!.description || undefined}
                  className="h-6 rounded bg-hover px-2 text-[11px] font-semibold text-fg-2 tabular-nums hover:bg-accent-soft hover:text-accent-strong"
                >
                  {labels.get(id) ?? '—'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
