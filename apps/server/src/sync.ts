import { Hocuspocus } from '@hocuspocus/server'
import { readMeta } from '@weft/model'
import * as Y from 'yjs'
import { userFromAccessToken, userFromHeaders, type PublicUser } from './auth'
import { isOriginAllowed } from './config'
import { log } from './log'
import { getProject, loadProjectState, projectIdFromDocName, saveProjectState } from './projects'

export interface SyncContext {
  user: PublicUser
  projectId: string
  via: 'session' | 'token'
}

/** Browser clients send this placeholder and are identified by their session cookie instead. */
export const SESSION_TOKEN_PLACEHOLDER = 'session'

export const hocuspocus = new Hocuspocus<SyncContext>({
  name: 'weft',
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,

  async onAuthenticate({ token, requestHeaders, documentName }) {
    const projectId = projectIdFromDocName(documentName)
    if (!projectId) throw new Error('Unknown document')

    let user: PublicUser | null = null
    let via: SyncContext['via'] = 'token'
    if (token && token !== SESSION_TOKEN_PLACEHOLDER) {
      user = userFromAccessToken(token)
    } else {
      // Cookies ride along on cross-site WebSocket requests too, so check where it came from.
      if (!isOriginAllowed(requestHeaders.get('origin'))) throw new Error('Origin not allowed')
      user = userFromHeaders(requestHeaders)
      via = 'session'
    }
    if (!user) throw new Error('Not signed in')

    const project = getProject(projectId)
    if (!project || project.deleted_at) throw new Error('Project not found')
    return { user, projectId, via } satisfies SyncContext
  },

  async onLoadDocument({ document, documentName }) {
    const projectId = projectIdFromDocName(documentName)
    const state = projectId ? loadProjectState(projectId) : null
    if (state) Y.applyUpdate(document, state)
    return document
  },

  async onStoreDocument({ document, documentName }) {
    const projectId = projectIdFromDocName(documentName)
    if (!projectId) return
    const meta = readMeta(document.getMap('meta'))
    saveProjectState(projectId, Y.encodeStateAsUpdate(document), { title: meta.title, type: meta.type })
  },

  async connected({ context, documentName }) {
    log.info(`${context.user.email} opened ${documentName} (${context.via})`)
  },
})
