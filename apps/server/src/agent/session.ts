import { Project, type ProjectSnapshot } from '@weft/model'
import * as Y from 'yjs'
import type { PublicUser } from '../auth'
import { log } from '../log'
import { docName, getProject } from '../projects'
import { hocuspocus } from '../sync'

export const AGENT_NAME = 'Claude'

type Connection = Awaited<ReturnType<typeof hocuspocus.openDirectConnection>>

/** How long a session (and so its undo history) lasts after Claude's last call. */
const IDLE_MS = 45 * 60 * 1000
/** Edits closer together than this belong to the same change set. */
const CHANGE_SET_GAP_MS = 15 * 60 * 1000

export class AgentError extends Error {}

/**
 * Claude's connection to one project, on behalf of one person. Edits go
 * straight into the live document, so everyone with the project open sees
 * them as they happen. They're grouped into change sets that people can keep
 * or undo, for as long as the session lasts.
 */
export class AgentSession {
  readonly projectId: string
  readonly user: PublicUser
  readonly doc: Y.Doc
  /** Edits made as Claude. The undo history tracks exactly these. */
  readonly project: Project
  /** Change-set bookkeeping, kept out of the undo history. */
  private readonly books: Project
  private readonly undo: Y.UndoManager
  private readonly connection: Connection
  private readonly changeSets = new Set<string>()
  private current: string | null = null
  private lastEdit = 0
  private timer: NodeJS.Timeout | null = null
  private closed = false
  onClose: (() => void) | null = null

  private constructor(projectId: string, user: PublicUser, connection: Connection) {
    this.projectId = projectId
    this.user = user
    this.connection = connection
    this.doc = connection.document!
    // Hocuspocus stores and broadcasts changes made with any origin, including these.
    const origin = { source: 'local', context: { agent: AGENT_NAME, userId: user.id } }
    this.project = new Project(this.doc, origin)
    this.books = new Project(this.doc, { source: 'local', context: { agent: AGENT_NAME, bookkeeping: true } })
    this.undo = new Y.UndoManager(this.project.roots, { trackedOrigins: new Set([origin]), captureTimeout: Number.MAX_SAFE_INTEGER })
    this.undo.on('stack-item-added', ({ stackItem, type }) => {
      if (type === 'undo' && this.current) stackItem.meta.set('changeSet', this.current)
    })
    this.touch()
  }

  static async open(projectId: string, user: PublicUser): Promise<AgentSession> {
    const row = getProject(projectId)
    if (!row || row.deleted_at) throw new AgentError(`Project ${projectId} doesn't exist`)
    const connection = await hocuspocus.openDirectConnection(docName(projectId), { user, projectId, via: 'token' })
    return new AgentSession(projectId, user, connection)
  }

  snapshot(): ProjectSnapshot {
    this.touch()
    return this.project.snapshot()
  }

  /**
   * Runs one tool's edits as a single undo step, and adds `describe(result)`
   * to the current change set (starting one if needed).
   */
  edit<T>(fn: () => T, describe: (result: T) => { line: string; frames?: readonly string[] }): { result: T; changeSetId: string } {
    if (this.closed) throw new AgentError('This session has ended')
    this.touch()
    const changeSetId = this.changeSet()
    this.undo.stopCapturing()
    const result = this.project.transact(fn)
    this.undo.stopCapturing()
    const { line, frames = [] } = describe(result)
    this.books.noteChange(changeSetId, line, frames.filter((id) => this.doc.getMap('frames').has(id)))
    this.lastEdit = Date.now()
    return { result, changeSetId }
  }

  /** The open change set to add to, or a fresh one after a pause or once people have dealt with the last. */
  private changeSet(): string {
    const status = this.current ? this.books.snapshot().changes[this.current]?.status : undefined
    if (this.current && status === 'open' && Date.now() - this.lastEdit < CHANGE_SET_GAP_MS) return this.current
    this.current = this.books.startChangeSet({ agent: AGENT_NAME, userId: this.user.id, userName: this.user.name })
    this.changeSets.add(this.current)
    return this.current
  }

  owns(changeSetId: string): boolean {
    return this.changeSets.has(changeSetId)
  }

  /** The change sets this session made, newest last. */
  ownChangeSets(): string[] {
    return [...this.changeSets]
  }

  /**
   * Reverses every edit in a change set, even if other edits (Claude's or
   * people's) came after. People's own edits are left alone. Returns how many
   * steps were undone.
   */
  undoChangeSet(changeSetId: string): number {
    this.touch()
    const mine = this.undo.undoStack.filter((item) => item.meta.get('changeSet') === changeSetId)
    if (mine.length) {
      // Move them to the top of the stack so undo() takes exactly these, newest first.
      this.undo.undoStack = [...this.undo.undoStack.filter((item) => !mine.includes(item)), ...mine]
      for (let i = 0; i < mine.length; i++) this.undo.undo()
      this.undo.redoStack = []
    }
    this.books.setChangeStatus(changeSetId, 'undone')
    if (this.current === changeSetId) this.current = null
    return mine.length
  }

  private touch(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.close(), IDLE_MS)
    this.timer.unref?.()
  }

  /** Ends the session: its change sets can't be undone from the app after this. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    try {
      const snapshot = this.books.snapshot()
      this.books.transact(() => {
        for (const id of this.changeSets) if (snapshot.changes[id]?.undoable) this.books.setChangeUndoable(id, false)
      })
    } catch (error) {
      log.warn(`couldn't close change sets for ${this.projectId}: ${(error as Error).message}`)
    }
    this.undo.destroy()
    this.onClose?.()
    await this.connection.disconnect()
  }
}

const sessions = new Map<string, Promise<AgentSession>>()
const keyOf = (projectId: string, userId: string) => `${projectId}:${userId}`

/** The session for this project and person, opening one if needed. */
export function sessionFor(projectId: string, user: PublicUser): Promise<AgentSession> {
  const key = keyOf(projectId, user.id)
  let pending = sessions.get(key)
  if (!pending) {
    pending = AgentSession.open(projectId, user).then(
      (session) => {
        session.onClose = () => sessions.delete(key)
        return session
      },
      (error: unknown) => {
        sessions.delete(key)
        throw error
      },
    )
    sessions.set(key, pending)
  }
  return pending
}

/** The live session that made a change set, if it's still running. */
export async function sessionWithChangeSet(projectId: string, changeSetId: string): Promise<AgentSession | null> {
  for (const [key, pending] of sessions) {
    if (!key.startsWith(`${projectId}:`)) continue
    const session = await pending.catch(() => null)
    if (session?.owns(changeSetId)) return session
  }
  return null
}

/** Change sets in this project that a running session can still undo. */
export async function liveChangeSets(projectId: string): Promise<string[]> {
  const out: string[] = []
  for (const [key, pending] of sessions) {
    if (!key.startsWith(`${projectId}:`)) continue
    const session = await pending.catch(() => null)
    if (session) out.push(...session.ownChangeSets())
  }
  return out
}

/** Ends every session (server shutdown, tests). */
export async function closeAllSessions(): Promise<void> {
  const all = await Promise.all([...sessions.values()].map((p) => p.catch(() => null)))
  await Promise.all(all.map((s) => s?.close()))
  sessions.clear()
}
