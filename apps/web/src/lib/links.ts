import { Project } from '@weft/model'
import { api } from './api'

export interface LinkPreview {
  url: string
  title: string
  description: string
  image: string | null
  site: string
}

const URL_PATTERN = /^https?:\/\/[^\s<>"]+$/i

/** The pasted text, if it's a single web link. */
export function singleUrl(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ''
  return URL_PATTERN.test(trimmed) ? trimmed : null
}

export async function fetchPreview(url: string): Promise<LinkPreview | null> {
  try {
    const { preview } = await api<{ preview: LinkPreview }>(`/api/unfurl?url=${encodeURIComponent(url)}`)
    return preview
  } catch {
    return null
  }
}

/**
 * Adds a link to the project's library right away, then fills in its preview
 * (title, image, site) once the server has read the page. The preview arrives
 * outside undo history, so undo removes the link rather than its title.
 */
export function addLink(project: Project, url: string, userId: string): { assetId: string; ready: Promise<void> } {
  const assetId = project.addAsset({ kind: 'link', url, name: url, title: url, createdBy: userId })
  const asset = project.assets.get(assetId)
  const hasPreview = !!asset && (asset.get('site') || asset.get('preview') || (asset.get('title') && asset.get('title') !== url))
  if (hasPreview) return { assetId, ready: Promise.resolve() }
  const quiet = new Project(project.doc, { source: 'preview' })
  const ready = fetchPreview(url).then((preview) => {
    if (!preview || !project.assets.has(assetId)) return
    quiet.updateAsset(assetId, { title: preview.title || url, preview: preview.image, site: preview.site })
  })
  return { assetId, ready }
}
