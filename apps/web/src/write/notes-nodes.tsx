import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { readAsset, type AssetKind, type Project } from '@weft/model'
import { ExternalLink, ImageOff } from 'lucide-react'
import { cx } from '../lib/cx'
import { mediaUrl } from '../lib/media'
import { useSnapshot } from '../project/hooks'

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** An image, video or audio file from the Library, placed in the notes. */
export const MediaNode = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
      },
      kind: {
        default: 'image',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'image',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
      src: {
        default: null,
        parseHTML: (el) => el.querySelector('img, video, audio')?.getAttribute('src') ?? null,
        renderHTML: () => ({}),
      },
      alt: {
        default: '',
        parseHTML: (el) => el.querySelector('img')?.getAttribute('alt') ?? '',
        renderHTML: () => ({}),
      },
    }
  },

  // Only Weft's own media is recognised when pasting HTML, so pages never hotlink images from other sites.
  parseHTML() {
    return [{ tag: 'figure[data-media][data-asset-id]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = node.attrs.src as string | null
    const inner =
      node.attrs.kind === 'video' ? ['video', { src, controls: 'true' }] : node.attrs.kind === 'audio' ? ['audio', { src, controls: 'true' }] : ['img', { src, alt: node.attrs.alt }]
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-media': '' }), inner]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaView)
  },
})

function MediaView({ node }: ReactNodeViewProps) {
  const s = useSnapshot()
  const { assetId, kind, src, alt } = node.attrs as { assetId: string | null; kind: AssetKind; src: string | null; alt: string }
  const asset = assetId ? s.assets[assetId] : undefined
  const url = asset?.hash ? mediaUrl(asset.hash) : src
  return (
    <NodeViewWrapper className="weft-media">
      <figure contentEditable={false} data-drag-handle>
        {!url ? (
          <div className="flex h-24 items-center justify-center gap-2 text-fg-3">
            <ImageOff size={16} aria-hidden /> Missing file
          </div>
        ) : kind === 'video' ? (
          <video src={url} controls preload="metadata" />
        ) : kind === 'audio' ? (
          <div className="flex items-center gap-3 p-3">
            <span className="min-w-0 flex-1 truncate text-fg-2">{asset?.name || alt || 'Audio'}</span>
            <audio src={url} controls preload="metadata" />
          </div>
        ) : (
          <img src={url} alt={asset?.name || alt} draggable={false} />
        )}
      </figure>
    </NodeViewWrapper>
  )
}

/** A link with its page's preview: title, picture and site. */
export const LinkCardNode = Node.create({
  name: 'linkCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
      },
      url: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-url') ?? el.querySelector('a')?.getAttribute('href') ?? '',
        renderHTML: (attrs) => ({ 'data-url': attrs.url }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.querySelector('a')?.textContent ?? '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-link-card]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-link-card': '' }), ['a', { href: node.attrs.url }, node.attrs.title || node.attrs.url]]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkCardView)
  },
})

function LinkCardView({ node, selected }: ReactNodeViewProps) {
  const s = useSnapshot()
  const { assetId, url, title } = node.attrs as { assetId: string | null; url: string; title: string }
  const asset = assetId ? s.assets[assetId] : undefined
  const href = asset?.url || url
  const heading = [asset?.title, title].find((t) => t && t !== href) ?? hostOf(href)
  const loading = !!asset && !asset.site && !asset.preview && asset.title === href
  return (
    <NodeViewWrapper className="weft-link-card">
      <div
        contentEditable={false}
        data-drag-handle
        className={cx(
          'flex min-h-[84px] overflow-hidden rounded-xl border bg-panel transition-colors',
          selected ? 'border-accent' : 'border-line hover:border-line-strong',
        )}
      >
        {asset?.preview && (
          <img src={asset.preview} alt="" referrerPolicy="no-referrer" draggable={false} className="w-[168px] shrink-0 object-cover" />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3.5 py-2.5">
          <span className="text-[11px] text-fg-3">{asset?.site || hostOf(href)}</span>
          <span className={cx('line-clamp-2 font-medium text-fg', loading && 'animate-pulse text-fg-2')}>{loading ? 'Reading the page…' : heading}</span>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1 text-[12px] text-accent-strong hover:underline"
          >
            <span className="truncate">{href}</span>
            <ExternalLink size={11} className="shrink-0" aria-hidden />
          </a>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** Editor content for Library assets: pictures, video and audio as media, links as cards. */
export function assetNodes(project: Project, assetIds: readonly string[]): JSONContent[] {
  return assetIds.flatMap((id): JSONContent[] => {
    const m = project.assets.get(id)
    if (!m) return []
    const asset = readAsset(m)
    if (asset.kind === 'link') return [{ type: 'linkCard', attrs: { assetId: id, url: asset.url ?? '', title: asset.title } }]
    return [{ type: 'media', attrs: { assetId: id, kind: asset.kind, src: asset.hash ? mediaUrl(asset.hash) : null, alt: asset.name } }]
  })
}
