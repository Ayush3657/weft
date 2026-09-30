import { formatDuration, rowsToScript, textToTable } from '@weft/model'
import { ClipboardPaste, Table2, X } from 'lucide-react'
import { useMemo, useState, type ClipboardEvent } from 'react'
import { cx } from '../lib/cx'
import { navigate, projectPath } from '../lib/router'
import { toast } from '../lib/toast'
import { useProject } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, Modal, textareaClass } from '../ui'
import { appendFrames } from './frames'

/** Text of a table cell, keeping its line breaks. */
function cellText(cell: HTMLTableCellElement): string {
  for (const br of cell.querySelectorAll('br')) br.replaceWith('\n')
  for (const block of cell.querySelectorAll('p, div, li, h1, h2, h3, h4')) block.append('\n')
  return (cell.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** The biggest table in pasted HTML (Word, Google Docs, Sheets, Excel), as rows of cell text. */
export function tableFromHtml(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = [...doc.querySelectorAll('table')]
  if (!tables.length) return null
  const biggest = tables.reduce((a, b) => (b.rows.length > a.rows.length ? b : a))
  return [...biggest.rows].map((row) => [...row.cells].map(cellText))
}

export function PasteScript({ open, onOpenChange, cutId }: { open: boolean; onOpenChange: (open: boolean) => void; cutId: string }) {
  const project = useProject()
  const { projectId } = useProjectContext()
  const [text, setText] = useState('')
  const [table, setTable] = useState<string[][] | null>(null)
  const rows = useMemo(() => rowsToScript(table ?? textToTable(text)), [table, text])

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setText('')
      setTable(null)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html')
    const parsed = html ? tableFromHtml(html) : null
    if (parsed?.length) {
      e.preventDefault()
      setTable(parsed)
      setText('')
    }
  }

  const create = () => {
    appendFrames(
      project,
      cutId,
      rows.map((r) => ({ description: r.video, vo: r.audio, onScreenText: r.text, duration: r.duration })),
    )
    toast(`Added ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} to the script and the board.`, 'ok', {
      label: 'Show board',
      run: () => navigate(projectPath(projectId, 'board')),
    })
    close(false)
  }

  const total = rows.reduce((n, r) => n + (r.duration ?? 0), 0)

  return (
    <Modal
      open={open}
      onOpenChange={close}
      width={760}
      title="Paste a script"
      description="Copy the table from Word, Google Docs, Sheets or Excel and paste it here. Plain text works too: one shot per line or paragraph, with a tab between picture and sound."
    >
      <div className="flex flex-col gap-4">
        {table ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5">
            <Table2 size={15} className="text-accent-strong" aria-hidden />
            <span className="flex-1 text-fg">
              Pasted a table with {table.length} {table.length === 1 ? 'row' : 'rows'}
            </span>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setTable(null)}>
              Clear
            </Button>
          </div>
        ) : (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            rows={6}
            placeholder={'Paste here\n\nAerial over the towers at dawn\tSome homes you buy.\nFamily walks into the lobby\tSome homes you grow into.'}
            aria-label="Script to paste"
            className={cx(textareaClass, 'min-h-[132px] font-mono text-[12px]')}
          />
        )}

        {rows.length > 0 && (
          <div className="max-h-[320px] overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-[11px] tracking-wide text-fg-3 uppercase">
                  <th className="w-8 px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Video</th>
                  <th className="px-2 py-1.5 font-medium">Audio</th>
                  <th className="px-2 py-1.5 font-medium">On screen</th>
                  <th className="w-14 px-2 py-1.5 text-right font-medium">Length</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-2 py-1.5 text-fg-3 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1.5 whitespace-pre-line text-fg">{row.video}</td>
                    <td className="px-2 py-1.5 whitespace-pre-line text-fg-2 italic">{row.audio}</td>
                    <td className="px-2 py-1.5 whitespace-pre-line text-fg-2">{row.text}</td>
                    <td className="px-2 py-1.5 text-right text-fg-2 tabular-nums">{row.duration ? formatDuration(row.duration) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-fg-3">
            {rows.length
              ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}${total ? `, ${formatDuration(total)} with the lengths given` : ''}. They're added after the last row of this cut.`
              : 'Columns are matched by their headings (Video, Audio, Super, Duration…) or taken in order.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant="primary" icon={<ClipboardPaste size={14} />} disabled={!rows.length} onClick={create}>
              {rows.length ? `Add ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : 'Add rows'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
