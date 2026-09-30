import * as Y from 'yjs'

/**
 * Notes pages are rich-text documents stored as Yjs XML, in the shape the
 * notes editor uses (TipTap's schema): paragraph, heading, bulletList,
 * orderedList, listItem, blockquote, horizontalRule, codeBlock and hardBreak,
 * plus Weft's media and linkCard blocks. Text formatting (bold, italic,
 * strike, code, link) is stored as text attributes. These helpers turn pages
 * into Markdown and back, for tools such as the MCP server.
 */

type Attrs = Record<string, unknown>
type Delta = Array<{ insert: unknown; attributes?: Attrs }>

// ------------------------------------------------------------------ reading

const markName = (key: string) => key.split('--')[0]!

function withMarks(text: string, attrs: Attrs): string {
  if (!text) return ''
  const names = Object.keys(attrs).map(markName)
  // Keep spaces outside the markers, where Markdown needs them.
  const lead = /^\s*/.exec(text)![0]
  const trail = /\s*$/.exec(text.slice(lead.length))![0]
  let core = text.slice(lead.length, text.length - trail.length)
  if (!core) return text
  if (names.includes('code')) core = `\`${core}\``
  if (names.includes('bold')) core = `**${core}**`
  if (names.includes('italic')) core = `*${core}*`
  if (names.includes('strike')) core = `~~${core}~~`
  const linkKey = Object.keys(attrs).find((k) => markName(k) === 'link')
  const href = linkKey ? (attrs[linkKey] as { href?: unknown } | null)?.href : undefined
  if (typeof href === 'string' && href) core = `[${core}](${href})`
  return lead + core + trail
}

function inline(el: Y.XmlElement): string {
  let out = ''
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Delta) if (typeof op.insert === 'string') out += withMarks(op.insert, op.attributes ?? {})
    } else if (child instanceof Y.XmlElement) {
      out += child.nodeName === 'hardBreak' ? '  \n' : inline(child)
    }
  }
  return out
}

const numAttr = (el: Y.XmlElement, name: string, fallback: number) => {
  const v = el.getAttribute(name) as unknown
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number(v) ? Number(v) : fallback
}

function block(node: Y.XmlElement | Y.XmlText, indent: string): string | null {
  if (node instanceof Y.XmlText) return indent + node.toString()
  const name = node.nodeName
  switch (name) {
    case 'paragraph':
      return indent + inline(node)
    case 'heading':
      return `${indent}${'#'.repeat(Math.min(6, Math.max(1, numAttr(node, 'level', 1))))} ${inline(node)}`
    case 'bulletList':
    case 'orderedList': {
      const start = numAttr(node, 'start', 1)
      return node
        .toArray()
        .filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
        .map((item, i) => {
          const marker = name === 'orderedList' ? `${start + i}. ` : '- '
          const parts = item.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
          const [first, ...rest] = parts
          const head = first ? (first.nodeName === 'paragraph' ? inline(first) : (block(first, '') ?? '')) : ''
          const nested = rest.map((p) => block(p, `${indent}  `)).filter((s): s is string => s !== null)
          return [`${indent}${marker}${head}`, ...nested].join('\n')
        })
        .join('\n')
    }
    case 'blockquote':
      return node
        .toArray()
        .map((c) => block(c as Y.XmlElement, ''))
        .filter((s): s is string => s !== null)
        .join('\n\n')
        .split('\n')
        .map((line) => `${indent}> ${line}`.trimEnd())
        .join('\n')
    case 'horizontalRule':
      return `${indent}---`
    case 'codeBlock': {
      const lang = node.getAttribute('language')
      const body = node.toArray().map((c) => (c instanceof Y.XmlText ? c.toString() : '')).join('')
      return `${indent}\`\`\`${typeof lang === 'string' ? lang : ''}\n${body}\n${indent}\`\`\``
    }
    case 'media': {
      const alt = node.getAttribute('alt')
      const kind = node.getAttribute('kind')
      const assetId = node.getAttribute('assetId')
      return `${indent}![${typeof alt === 'string' && alt ? alt : typeof kind === 'string' ? kind : 'media'}](asset:${typeof assetId === 'string' ? assetId : ''})`
    }
    case 'linkCard': {
      const url = node.getAttribute('url')
      const title = node.getAttribute('title')
      if (typeof url !== 'string' || !url) return null
      return `${indent}[${typeof title === 'string' && title ? title : url}](${url})`
    }
    default:
      return indent + inline(node)
  }
}

/** A notes page as Markdown. Pictures show as `![name](asset:<id>)`. */
export function notesToMarkdown(fragment: Y.XmlFragment): string {
  return fragment
    .toArray()
    .map((child) => block(child as Y.XmlElement | Y.XmlText, ''))
    .filter((s): s is string => s !== null)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ------------------------------------------------------------------ writing

interface Span {
  text: string
  attrs: Attrs
}

const INLINE = [
  { re: /^`([^`]+)`/, mark: 'code' },
  { re: /^\*\*([^*]+?)\*\*/, mark: 'bold' },
  { re: /^__([^_]+?)__/, mark: 'bold' },
  { re: /^~~([^~]+?)~~/, mark: 'strike' },
  { re: /^\*([^*\s][^*]*?)\*/, mark: 'italic' },
  { re: /^_([^_\s][^_]*?)_(?![A-Za-z0-9])/, mark: 'italic' },
] as const

/** Inline Markdown (bold, italic, strike, code, links) to formatted text runs. */
function parseInline(source: string, inherited: Attrs = {}): Span[] {
  const spans: Span[] = []
  let plain = ''
  const flush = () => {
    if (plain) spans.push({ text: plain, attrs: inherited })
    plain = ''
  }
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest)
    if (link) {
      flush()
      spans.push(...parseInline(link[1]!, { ...inherited, link: { href: link[2]! } }))
      i += link[0].length
      continue
    }
    const bare = /^(?:<)?(https?:\/\/[^\s<>)]+[^\s<>).,;:!?'"])(?:>)?/.exec(rest)
    if (bare && (i === 0 || /\s|\(/.test(source[i - 1]!))) {
      flush()
      spans.push({ text: bare[1]!, attrs: { ...inherited, link: { href: bare[1]! } } })
      i += bare[0].length
      continue
    }
    const formatted = INLINE.map((f) => ({ f, m: f.re.exec(rest) })).find((x) => x.m)
    if (formatted?.m && (formatted.f.mark === 'code' || !(formatted.f.mark in inherited))) {
      flush()
      const attrs = { ...inherited, [formatted.f.mark]: {} }
      if (formatted.f.mark === 'code') spans.push({ text: formatted.m[1]!, attrs })
      else spans.push(...parseInline(formatted.m[1]!, attrs))
      i += formatted.m[0].length
      continue
    }
    plain += source[i]
    i++
  }
  flush()
  return spans
}

function textBlock(name: string, source: string, attrs: Attrs = {}): Y.XmlElement {
  const el = new Y.XmlElement(name)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value as string)
  const spans = parseInline(source.trim())
  if (spans.length) {
    // A delta rather than insert(): insert() without attributes carries on the formatting before it.
    const text = new Y.XmlText()
    text.applyDelta(spans.map((s) => (Object.keys(s.attrs).length ? { insert: s.text, attributes: s.attrs } : { insert: s.text })))
    el.insert(0, [text])
  }
  return el
}

interface ListLine {
  depth: number
  ordered: boolean
  text: string
}

/** Nested lists from indented "- item" / "1. item" lines. */
function buildList(lines: ListLine[], depth: number): Y.XmlElement {
  const list = new Y.XmlElement(lines[0]!.ordered ? 'orderedList' : 'bulletList')
  const items: Y.XmlElement[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const item = new Y.XmlElement('listItem')
    const children: Y.XmlElement[] = [textBlock('paragraph', line.text)]
    const nested: ListLine[] = []
    i++
    while (i < lines.length && lines[i]!.depth > depth) nested.push(lines[i++]!)
    if (nested.length) children.push(buildList(nested, nested[0]!.depth))
    item.insert(0, children)
    items.push(item)
  }
  list.insert(0, items)
  return list
}

/** Markdown to notes blocks: headings, paragraphs, lists, quotes, rules and code. */
export function markdownToBlocks(markdown: string): Y.XmlElement[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Y.XmlElement[] = []
  let paragraph: string[] = []
  const endParagraph = () => {
    if (paragraph.length) blocks.push(textBlock('paragraph', paragraph.join(' ')))
    paragraph = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence) {
      endParagraph()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      const code = new Y.XmlElement('codeBlock')
      if (fence[1]) code.setAttribute('language', fence[1])
      if (body.length) code.insert(0, [new Y.XmlText(body.join('\n'))])
      blocks.push(code)
      continue
    }
    if (!line.trim()) {
      endParagraph()
      i++
      continue
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      endParagraph()
      blocks.push(textBlock('heading', heading[2]!.replace(/\s+#+\s*$/, ''), { level: Math.min(3, heading[1]!.length) }))
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endParagraph()
      blocks.push(new Y.XmlElement('horizontalRule'))
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      endParagraph()
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      const quote = new Y.XmlElement('blockquote')
      const inner = markdownToBlocks(quoted.join('\n'))
      quote.insert(0, inner.length ? inner : [new Y.XmlElement('paragraph')])
      blocks.push(quote)
      continue
    }
    const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (listItem) {
      endParagraph()
      const items: ListLine[] = []
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!)
        if (!m) break
        const item = { depth: Math.floor(m[1]!.replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m[2]!), text: m[3]! }
        // Switching between bullets and numbers at the top level starts a new list.
        if (items.length && item.depth <= items[0]!.depth && item.ordered !== items[0]!.ordered) break
        items.push(item)
        i++
      }
      const top = Math.min(...items.map((l) => l.depth))
      blocks.push(buildList(items.map((l) => ({ ...l, depth: l.depth - top })), 0))
      continue
    }
    paragraph.push(line.trim())
    i++
  }
  endParagraph()
  return blocks
}

/** Adds Markdown to the end of a notes page. */
export function appendMarkdown(fragment: Y.XmlFragment, markdown: string): void {
  const blocks = markdownToBlocks(markdown)
  if (!blocks.length) return
  // The editor keeps an empty paragraph at the end; write over it rather than after it.
  const last = fragment.length ? fragment.get(fragment.length - 1) : null
  const trailingEmpty = last instanceof Y.XmlElement && last.nodeName === 'paragraph' && last.length === 0
  const run = () => {
    if (trailingEmpty) fragment.delete(fragment.length - 1, 1)
    fragment.insert(fragment.length, blocks)
  }
  if (fragment.doc) fragment.doc.transact(run)
  else run()
}
