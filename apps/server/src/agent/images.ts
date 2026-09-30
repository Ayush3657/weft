import sharp from 'sharp'
import { mediaFile } from '../media'

/** Recent previews, so looking at the same frames twice is instant. */
const cache = new Map<string, Buffer>()
function remember(key: string, value: Buffer): Buffer {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > 80) cache.delete(cache.keys().next().value!)
  return value
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** A JPEG no larger than `max` pixels on its longest side, or null if the file isn't a still picture. */
export async function previewJpeg(hash: string, max = 1280): Promise<Buffer | null> {
  const key = `${hash}:${max}`
  const hit = cache.get(key)
  if (hit) return remember(key, hit)
  const file = mediaFile(hash)
  if (!file) return null
  try {
    const out = await sharp(file, { animated: false })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#16161b' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    return remember(key, out)
  } catch {
    return null
  }
}

/** Width and height of a picture, if it is one. */
export async function imageSize(input: Buffer | string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(input, { animated: false }).metadata()
    if (!meta.width || !meta.height) return null
    // Phone photos are often stored sideways with an orientation flag.
    const turned = (meta.orientation ?? 1) >= 5
    return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

function wrap(text: string, perLine: number, lines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const out: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    if ((line ? `${line} ${word}` : word).length > perLine && line) {
      out.push(line)
      line = word
      if (out.length === lines) break
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (out.length < lines && line) out.push(line)
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = `${out[lines - 1]!.replace(/.{0,2}$/, '')}…`
  return out
}

export interface SheetCell {
  hash: string | null
  label: string
  /** Shown instead of a picture when there isn't one. */
  caption: string
}

/**
 * The frames of a cut in a grid, each marked with its shot number: a whole
 * storyboard in one picture. Frames without a still show their description.
 */
export async function contactSheet(cells: readonly SheetCell[], aspect: number): Promise<Buffer> {
  const columns = aspect >= 1.2 ? 4 : aspect >= 0.9 ? 5 : 6
  const gap = 12
  const width = 1500
  const cellW = Math.floor((width - gap * (columns + 1)) / columns)
  const cellH = Math.round(cellW / aspect)
  const rows = Math.max(1, Math.ceil(cells.length / columns))
  const height = gap + rows * (cellH + gap)
  const font = 'Segoe UI, Helvetica, Arial, sans-serif'

  const layers = await Promise.all(
    cells.map(async (cell, i) => {
      const left = gap + (i % columns) * (cellW + gap)
      const top = gap + Math.floor(i / columns) * (cellH + gap)
      let picture: Buffer | null = null
      const file = cell.hash ? mediaFile(cell.hash) : null
      if (file) {
        picture = await sharp(file, { animated: false })
          .rotate()
          .resize(cellW, cellH, { fit: 'cover' })
          .toBuffer()
          .catch(() => null)
      }
      const badgeW = 18 + cell.label.length * 11
      const caption = picture
        ? ''
        : wrap(cell.caption || 'No picture yet', Math.floor(cellW / 8.5), Math.max(1, Math.floor((cellH - 60) / 20)))
            .map((line, n) => `<text x="12" y="${62 + n * 20}" font-family="${font}" font-size="15" fill="#c9c9d2">${escapeXml(line)}</text>`)
            .join('')
      const overlay = Buffer.from(
        `<svg width="${cellW}" height="${cellH}" xmlns="http://www.w3.org/2000/svg">` +
          (picture ? '' : `<rect width="${cellW}" height="${cellH}" fill="#26262e"/>`) +
          `<rect x="8" y="8" width="${badgeW}" height="30" rx="6" fill="#8e7dff"/>` +
          `<text x="17" y="30" font-family="${font}" font-size="18" font-weight="700" fill="#ffffff">${escapeXml(cell.label)}</text>` +
          caption +
          `</svg>`,
      )
      const tile = picture
        ? await sharp(picture).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer()
        : await sharp(overlay).png().toBuffer()
      return { input: tile, left, top }
    }),
  )

  return sharp({ create: { width, height, channels: 3, background: '#111116' } })
    .composite(layers)
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
}
