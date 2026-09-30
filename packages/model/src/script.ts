/**
 * Turning a pasted AV script (a table from Word, Google Docs or Sheets) into
 * frames. The table cells arrive as rows of strings; this works out which
 * column is which.
 */

export interface ScriptRow {
  video: string
  audio: string
  text: string
  /** Seconds, if the script has a duration column. */
  duration: number | null
}

type Role = 'video' | 'audio' | 'text' | 'duration' | 'number' | 'other'

const HEADER_PATTERNS: Array<[Role, RegExp]> = [
  ['number', /^(#|no\.?|shot|scene|sc\.?|sl\.?\s*no\.?|s\.?\s*no\.?)$/i],
  ['video', /^(video|visuals?|picture|pictures|scene description|description|action|shot description|what we see)$/i],
  ['audio', /^(audio|vo|v\.?o\.?|voice ?over|voiceover|sound|dialogue|dialog|script|what we hear|narration)$/i],
  ['text', /^(supers?|on[- ]?screen( text)?|text|graphics|titles?|captions?|copy)$/i],
  ['duration', /^(duration|time|timing|length|secs?|seconds|dur\.?)$/i],
]

function headerRole(cell: string): Role | null {
  const clean = cell.trim().replace(/[:*]+$/, '')
  for (const [role, pattern] of HEADER_PATTERNS) if (pattern.test(clean)) return role
  return null
}

/** "3", "3s", "3 sec", "0:03", "00:00:03", "2.5" -> seconds. */
export function parseDuration(cell: string): number | null {
  const text = cell.trim().toLowerCase()
  if (!text) return null
  const clock = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text)
  if (clock) {
    const [, h, m, s] = clock
    return (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) || null
  }
  const plain = /^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|seconds|")?$/.exec(text)
  if (plain) return Number(plain[1]!.replace(',', '.')) || null
  return null
}

const isShotNumber = (cell: string) => /^\s*\d+[a-z]?\.?\s*$/i.test(cell)

/** "VO: Every morning starts here." -> "Every morning starts here." (other labels, like SFX:, stay). */
const stripVoLabels = (cell: string) =>
  cell
    .split('\n')
    .map((line) => line.replace(/^\s*(?:v\.?\s?o\.?|voice[\s-]?over|[mf]vo)\s*[:\-–—]\s*/i, ''))
    .join('\n')

/**
 * Maps table rows to script rows. With a recognisable header row, columns are
 * matched by name; otherwise the first text columns are taken as video, then
 * audio, then on-screen text, skipping a leading shot-number column.
 */
export function rowsToScript(table: readonly (readonly string[])[]): ScriptRow[] {
  const rows = table.map((r) => r.map((c) => c.replace(/ /g, ' ').trim())).filter((r) => r.some(Boolean))
  if (!rows.length) return []

  // A header row names at least one content column, and at least half its cells are column names.
  const header = rows[0]!.map(headerRole)
  const recognised = header.filter((r) => r !== null).length
  const nonEmpty = rows[0]!.filter(Boolean).length
  const hasHeader =
    (header.includes('video') || header.includes('audio') || header.includes('text')) && recognised * 2 >= nonEmpty
  let roles: Role[]
  let body: string[][]
  if (hasHeader) {
    roles = header.map((r) => r ?? 'other')
    body = rows.slice(1)
  } else {
    const width = Math.max(...rows.map((r) => r.length))
    const numbered = rows.every((r) => !r[0] || isShotNumber(r[0]))
    const order: Role[] = ['video', 'audio', 'text']
    roles = Array.from({ length: width }, (_, i) => {
      if (numbered && i === 0 && width > 1) return 'number'
      if (rows.every((r) => !r[i] || parseDuration(r[i]!) !== null) && rows.some((r) => r[i])) return 'duration'
      return order.shift() ?? 'other'
    })
    body = rows
  }

  const pick = (row: string[], role: Role) =>
    roles
      .map((r, i) => (r === role ? row[i] ?? '' : ''))
      .filter(Boolean)
      .join('\n')

  return body
    .map((row) => ({
      video: pick(row, 'video'),
      audio: stripVoLabels(pick(row, 'audio')),
      text: pick(row, 'text'),
      duration: parseDuration(pick(row, 'duration')),
    }))
    .filter((r) => r.video || r.audio || r.text)
}

/** Plain pasted text: tab-separated columns if there are tabs, otherwise one frame per paragraph. */
export function textToTable(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.some((l) => l.includes('\t'))) return lines.filter((l) => l.trim()).map((l) => l.split('\t'))
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => [p])
}
