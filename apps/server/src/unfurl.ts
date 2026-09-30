import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

export interface LinkPreview {
  url: string
  title: string
  description: string
  image: string | null
  site: string
}

export class UnfurlError extends Error {
  readonly status: 400 | 502

  constructor(status: 400 | 502, message: string) {
    super(message)
    this.status = status
  }
}

// ----------------------------------------------------------- address safety

function ipv4Number(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

/** True only for addresses on the public internet: never this machine, the LAN, or cloud metadata. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const n = ipv4Number(ip)
    return !PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4Number(base) >>> (32 - bits)))
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return false
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPublicAddress(mapped[1]!)
    if (/^(fe[89ab]|fc|fd|ff)/.test(lower)) return false // link-local, unique local, multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')) return false
    return true
  }
  return false
}

/** DNS lookup that refuses to connect anywhere non-public. Checked at connect time, so rebinding can't sneak past. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0)
    if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new Error(`Blocked address for ${hostname}`), '', 0)
    }
    if ((options as { all?: boolean }).all) {
      ;(callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
    } else {
      callback(null, addresses[0]!.address, addresses[0]!.family)
    }
  })
}

export function parsePublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnfurlError(400, "That doesn't look like a web address")
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnfurlError(400, 'Only web links can be previewed')
  if (url.username || url.password) throw new UnfurlError(400, "Links with passwords can't be previewed")
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host)) throw new UnfurlError(400, "That address can't be previewed")
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnfurlError(400, "That address can't be previewed")
  }
  return url
}

// ------------------------------------------------------------------ fetching

const MAX_BYTES = 768 * 1024
const TIMEOUT_MS = 6000
const MAX_REDIRECTS = 4

interface Fetched {
  url: URL
  contentType: string
  body: string
}

function get(url: URL): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WeftLinkPreview/0.1)',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = String(res.headers['content-type'] ?? '')
        const location = typeof res.headers.location === 'string' ? res.headers.location : null
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, location, contentType, body: '' })
          return
        }
        const textual = /text\/html|application\/xhtml|json/.test(contentType)
        if (!textual) {
          res.destroy()
          resolve({ status, location, contentType, body: '' })
          return
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) {
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on('close', () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
  })
}

async function fetchPublic(start: URL): Promise<Fetched> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await get(url)
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = parsePublicUrl(new URL(res.location, url).toString())
      continue
    }
    if (res.status >= 400) throw new UnfurlError(502, `The page answered with an error (${res.status})`)
    return { url, contentType: res.contentType, body: res.body }
  }
  throw new UnfurlError(502, 'Too many redirects')
}

// ------------------------------------------------------------------- parsing

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITIES[code.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''
  }
  return out
}

/** Title, description, image and site name from a page's <head> (Open Graph, Twitter cards, <title>). */
export function parsePreview(html: string, pageUrl: URL): Omit<LinkPreview, 'url'> {
  const head = html.slice(0, html.search(/<\/head>/i) >>> 0 || html.length)
  const meta: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0])
    const key = (a.property ?? a.name ?? '').toLowerCase()
    if (key && a.content !== undefined && !(key in meta)) meta[key] = decode(a.content)
  }
  const title = meta['og:title'] ?? meta['twitter:title'] ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '')
  const rawImage = meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? null
  let image: string | null = null
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl)
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') image = resolved.toString()
    } catch {
      image = null
    }
  }
  return {
    title: title.slice(0, 300),
    description: (meta['og:description'] ?? meta['twitter:description'] ?? meta.description ?? '').slice(0, 500),
    image,
    site: meta['og:site_name'] ?? pageUrl.hostname.replace(/^www\./, ''),
  }
}

// -------------------------------------------------------------------- oEmbed

/** Video sites answer oEmbed with a clean title and thumbnail. */
function oembedEndpoint(url: URL): URL | null {
  const host = url.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    return new URL(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`)
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    return new URL(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.toString())}`)
  }
  return null
}

const cache = new Map<string, { at: number; preview: LinkPreview }>()
const CACHE_MS = 60 * 60 * 1000

export async function unfurl(raw: string): Promise<LinkPreview> {
  const url = parsePublicUrl(raw.trim())
  const key = url.toString()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.preview

  let preview: LinkPreview | null = null
  const endpoint = oembedEndpoint(url)
  if (endpoint) {
    try {
      const res = await fetchPublic(endpoint)
      const data = JSON.parse(res.body) as { title?: string; thumbnail_url?: string; provider_name?: string; author_name?: string }
      preview = {
        url: key,
        title: data.title ?? '',
        description: data.author_name ?? '',
        image: data.thumbnail_url ?? null,
        site: data.provider_name ?? url.hostname,
      }
    } catch {
      preview = null
    }
  }
  if (!preview) {
    try {
      const res = await fetchPublic(url)
      if (res.contentType.startsWith('image/')) {
        preview = { url: key, title: url.pathname.split('/').pop() ?? '', description: '', image: key, site: url.hostname }
      } else {
        preview = { url: key, ...parsePreview(res.body, res.url) }
      }
    } catch (error) {
      if (error instanceof UnfurlError) throw error
      throw new UnfurlError(502, "Couldn't reach that page")
    }
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), preview })
  return preview
}
