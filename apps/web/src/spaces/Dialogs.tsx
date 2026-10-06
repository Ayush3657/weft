import { ChevronRight, Crown, Folder, Lock, Mail, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, type FolderInfo, type MemberInfo, type SpaceContents, type SpaceSummary } from '../lib/api'
import { useUser } from '../lib/auth'
import { cx } from '../lib/cx'
import { toastError } from '../lib/toast'
import { Avatar, Button, Field, IconButton, Input, Modal, Spinner } from '../ui'
import { childrenOf, refreshContents, reload, useContents } from './store'

/** A dialog asking for one name: a new space or folder, or renaming one. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = '',
  placeholder,
  action,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  label: string
  initial?: string
  placeholder?: string
  action: string
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onOpenChange(false)
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={label} htmlFor="name-dialog-input">
          <Input id="name-dialog-input" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || name.trim() === initial}>
            {action}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** "Are you sure?" for deleting. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  action: string
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
              onOpenChange(false)
            } catch (error) {
              toastError(error)
            } finally {
              setBusy(false)
            }
          }}
        >
          {action}
        </Button>
      </div>
    </Modal>
  )
}

/** Who's in a team space: add people by email, take them out, make them owners. */
export function MembersDialog({ space, open, onOpenChange }: { space: SpaceSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useUser()
  const [members, setMembers] = useState<MemberInfo[] | null>(null)
  const [invites, setInvites] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const owner = space.role === 'owner'

  const take = (r: { members: MemberInfo[]; invites: string[] }) => {
    setMembers(r.members)
    setInvites(r.invites)
  }
  useEffect(() => {
    if (!open) return
    setEmail('')
    api<{ members: MemberInfo[]; invites: string[] }>(`/api/spaces/${space.id}/members`).then(take, toastError)
  }, [open, space.id])

  const run = async (request: () => Promise<{ members: MemberInfo[]; invites: string[] } | { ok: true }>) => {
    setBusy(true)
    try {
      const result = await request()
      if ('members' in result) take(result)
      await reload(space.id)
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    void run(async () => {
      const result = await api<{ members: MemberInfo[]; invites: string[] }>(`/api/spaces/${space.id}/members`, { method: 'POST', body: { email } })
      setEmail('')
      return result
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={`People in ${space.name}`}
      description="Everyone here sees and edits every storyboard, folder and library in this space, and so does their Claude."
    >
      <div className="flex flex-col gap-4">
        {owner && (
          <form onSubmit={add} className="flex gap-2">
            <Input
              aria-label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1"
            />
            <Button type="submit" variant="primary" icon={<UserPlus size={14} />} busy={busy} disabled={!email.trim()}>
              Add
            </Button>
          </form>
        )}
        {members === null ? (
          <Spinner />
        ) : (
          <ul className="flex flex-col">
            {members.map((m) => (
              <li key={m.id} className="flex h-11 items-center gap-3 border-b border-line last:border-b-0">
                <Avatar name={m.name} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">
                    {m.name}
                    {m.id === me.id && <span className="text-fg-3"> (you)</span>}
                  </div>
                  <div className="truncate text-[12px] text-fg-3">{m.email}</div>
                </div>
                {m.role === 'owner' && (
                  <span className="flex items-center gap-1 text-[12px] text-fg-2">
                    <Crown size={12} aria-hidden /> Owner
                  </span>
                )}
                {owner && m.id !== me.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/api/spaces/${space.id}/members/${m.id}`, { method: 'PATCH', body: { role: m.role === 'owner' ? 'member' : 'owner' } }),
                      )
                    }
                  >
                    {m.role === 'owner' ? 'Make member' : 'Make owner'}
                  </Button>
                )}
                {(owner || m.id === me.id) && (
                  <IconButton
                    size="sm"
                    label={m.id === me.id ? 'Leave this space' : `Take ${m.name} out of this space`}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await api<{ members: MemberInfo[]; invites: string[] } | { ok: true }>(`/api/spaces/${space.id}/members/${m.id}`, {
                          method: 'DELETE',
                        })
                        if (m.id === me.id) onOpenChange(false)
                        return result
                      })
                    }
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </li>
            ))}
            {invites.map((address) => (
              <li key={address} className="flex h-11 items-center gap-3 border-b border-line last:border-b-0">
                <span className="flex size-[26px] items-center justify-center rounded-full bg-hover text-fg-3">
                  <Mail size={13} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">{address}</div>
                  <div className="text-[12px] text-fg-3">Joins when they first sign in to Weft</div>
                </div>
                {owner && (
                  <IconButton
                    size="sm"
                    label={`Cancel the invitation for ${address}`}
                    disabled={busy}
                    onClick={() => void run(() => api(`/api/spaces/${space.id}/invites/${encodeURIComponent(address)}`, { method: 'DELETE' }))}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {!owner && <p className="text-[12px] text-fg-3">Only the space's owners can add people.</p>}
      </div>
    </Modal>
  )
}

/** Where to move a storyboard: any space you're in, at its top level or in a folder. */
export function MoveDialog({
  open,
  onOpenChange,
  title,
  spaces,
  from,
  folderOnly,
  exclude,
  onMove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  spaces: readonly SpaceSummary[]
  /** Where it is now. */
  from: { spaceId: string; folderId: string | null }
  /** Folders only move within their space. */
  folderOnly?: boolean
  /** Folders it can't go into (a folder can't go inside itself). */
  exclude?: ReadonlySet<string>
  onMove: (to: { spaceId: string; folderId: string | null }) => Promise<void>
}) {
  const [spaceId, setSpaceId] = useState(from.spaceId)
  const [folderId, setFolderId] = useState<string | null>(from.folderId)
  const [busy, setBusy] = useState(false)
  const contents = useContents(spaceId)
  useEffect(() => {
    if (!open) return
    setSpaceId(from.spaceId)
    setFolderId(from.folderId)
  }, [open, from.spaceId, from.folderId])
  useEffect(() => {
    if (open) void refreshContents(spaceId).catch(toastError)
  }, [open, spaceId])

  const same = spaceId === from.spaceId && folderId === from.folderId
  const choices = folderOnly ? spaces.filter((s) => s.id === from.spaceId) : spaces
  return (
    <Modal open={open} onOpenChange={onOpenChange} width={560} title={title}>
      <div className="flex h-[320px] gap-3">
        {choices.length > 1 && (
          <ul className="flex w-[180px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line pr-3">
            {choices.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSpaceId(s.id)
                    setFolderId(null)
                  }}
                  className={cx(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                    s.id === spaceId ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
                  )}
                >
                  {s.kind === 'personal' ? <Lock size={13} aria-hidden /> : <Users size={13} aria-hidden />}
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <FolderChoice
            label={`${spaces.find((s) => s.id === spaceId)?.name ?? 'Space'} (top level)`}
            depth={0}
            chosen={folderId === null}
            onChoose={() => setFolderId(null)}
          />
          {contents && contents.space.id === spaceId ? (
            <FolderChoices contents={contents} parentId={null} depth={1} chosen={folderId} exclude={exclude} onChoose={setFolderId} />
          ) : (
            <div className="p-3">
              <Spinner />
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={same}
          onClick={async () => {
            setBusy(true)
            try {
              await onMove({ spaceId, folderId })
              onOpenChange(false)
            } catch (error) {
              toastError(error)
            } finally {
              setBusy(false)
            }
          }}
        >
          Move here
        </Button>
      </div>
    </Modal>
  )
}

function FolderChoices({
  contents,
  parentId,
  depth,
  chosen,
  exclude,
  onChoose,
}: {
  contents: SpaceContents
  parentId: string | null
  depth: number
  chosen: string | null
  exclude?: ReadonlySet<string>
  onChoose: (folderId: string) => void
}) {
  return (
    <>
      {childrenOf(contents.folders, parentId)
        .filter((f: FolderInfo) => !exclude?.has(f.id))
        .map((f) => (
          <div key={f.id}>
            <FolderChoice label={f.name} depth={depth} chosen={chosen === f.id} onChoose={() => onChoose(f.id)} />
            <FolderChoices contents={contents} parentId={f.id} depth={depth + 1} chosen={chosen} exclude={exclude} onChoose={onChoose} />
          </div>
        ))}
    </>
  )
}

function FolderChoice({ label, depth, chosen, onChoose }: { label: string; depth: number; chosen: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      style={{ paddingLeft: 8 + depth * 16 }}
      className={cx('flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px]', chosen ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg')}
    >
      {depth === 0 ? <ChevronRight size={13} className="opacity-0" aria-hidden /> : <Folder size={13} aria-hidden />}
      <span className="truncate">{label}</span>
    </button>
  )
}
