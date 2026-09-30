import Collaboration from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extensions'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Clapperboard,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Redo2,
  Strikethrough,
  TextQuote,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useUser } from '../lib/auth'
import { droppedAssetIds } from '../lib/dnd'
import { claimFocus } from '../lib/focus'
import { addLink, singleUrl } from '../lib/links'
import { importFiles, mediaFiles } from '../lib/media'
import { navigate, projectPath } from '../lib/router'
import { toast } from '../lib/toast'
import { useProject, useSnapshot } from '../project/hooks'
import { useProjectContext } from '../project/ProjectProvider'
import { Button, Field, IconButton, Input, Kbd, Modal } from '../ui'
import { useFilePicker } from '../ui/inputs'
import { appendFrames } from './frames'
import { LinkCardNode, MediaNode, assetNodes } from './notes-nodes'

/**
 * Where to put block content arriving at `pos`: an empty paragraph there is
 * replaced; otherwise it goes after the block that holds `pos`.
 */
function blockRange(state: EditorState, pos: number): { from: number; to: number } {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
  if ($pos.depth === 0) return { from: $pos.pos, to: $pos.pos }
  const block = $pos.node(1)
  if (block.type.name === 'paragraph' && block.content.size === 0) return { from: $pos.before(1), to: $pos.after(1) }
  return { from: $pos.after(1), to: $pos.after(1) }
}

/** Keeps a document position up to date while something async (an upload) finishes. */
function trackPosition(editor: Editor, pos: number) {
  const tracked = { pos, stop: () => editor.off('transaction', onTransaction) }
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    tracked.pos = transaction.mapping.map(tracked.pos)
  }
  editor.on('transaction', onTransaction)
  return tracked
}

/** Text of each block the selection touches (only the selected part), for "Make frames". */
function selectedLines(state: EditorState): string[] {
  const { from, to } = state.selection
  const lines: string[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const text = state.doc.textBetween(Math.max(from, pos + 1), Math.min(to, pos + node.nodeSize - 1), ' ').trim()
    if (text) lines.push(text)
    return false
  })
  return lines
}

export function Notes({ pageId, cutId, isFirst }: { pageId: string; cutId: string; isFirst: boolean }) {
  const s = useSnapshot()
  const project = useProject()
  const user = useUser()
  const { projectId } = useProjectContext()
  const [fragment] = useState(() => project.pageFragment(pageId))
  const [linkOpen, setLinkOpen] = useState(false)
  const page = s.pages[pageId]

  // The editor is created once; its handlers read the latest values from here.
  const latest = useRef({ project, user })
  latest.current = { project, user }
  const editorRef = useRef<Editor | null>(null)

  const insertAssets = (assetIds: string[], at: number) => {
    const editor = editorRef.current
    const nodes = assetNodes(latest.current.project, assetIds)
    if (!editor || !nodes.length) return
    editor.chain().focus().insertContentAt(blockRange(editor.state, at), nodes).run()
  }

  const insertFiles = async (files: File[], at: number) => {
    const editor = editorRef.current
    if (!editor) return
    const tracked = trackPosition(editor, at)
    try {
      const ids = await importFiles(latest.current.project, files, latest.current.user.id)
      insertAssets(ids, tracked.pos)
    } finally {
      tracked.stop()
    }
  }

  const insertLink = (url: string, at: number) => {
    const { assetId } = addLink(latest.current.project, url, latest.current.user.id)
    insertAssets([assetId], at)
  }

  const handlers = useRef({ insertAssets, insertFiles, insertLink })
  handlers.current = { insertAssets, insertFiles, insertLink }

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
          dropcursor: { color: 'var(--accent)', width: 2 },
        }),
        Collaboration.configure({ fragment }),
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === 'heading' ? 'Heading' : 'Write anything. Paste links and images, or drag them in from the Library.',
        }),
        MediaNode,
        LinkCardNode,
      ],
      editorProps: {
        attributes: { class: 'weft-prose', 'aria-label': 'Notes', spellcheck: 'true' },
        handlePaste: (view: EditorView, event: ClipboardEvent) => {
          const files = mediaFiles(event.clipboardData)
          if (files.length) {
            void handlers.current.insertFiles(files, view.state.selection.from)
            return true
          }
          // A link pasted on its own line becomes a card; inside a sentence it stays a link.
          const url = singleUrl(event.clipboardData?.getData('text/plain'))
          const { selection } = view.state
          if (url && selection.empty && selection.$from.parent.type.name === 'paragraph' && selection.$from.parent.content.size === 0) {
            handlers.current.insertLink(url, selection.from)
            return true
          }
          return false
        },
        handleDrop: (view: EditorView, event: DragEvent, _slice, moved: boolean) => {
          if (moved) return false
          const files = mediaFiles(event.dataTransfer)
          const assetIds = droppedAssetIds(event.dataTransfer)
          if (!files.length && !assetIds.length) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.doc.content.size
          if (files.length) void handlers.current.insertFiles(files, at)
          else handlers.current.insertAssets(assetIds, at)
          return true
        },
      },
    },
    [fragment],
  )
  editorRef.current = editor

  const picker = useFilePicker((files) => void insertFiles(files, editor.state.selection.from), 'image/*,video/*,audio/*')

  const makeFrames = () => {
    const lines = selectedLines(editor.state)
    if (!lines.length) return
    appendFrames(
      project,
      cutId,
      lines.map((description) => ({ description })),
    )
    toast(`Made ${lines.length} ${lines.length === 1 ? 'frame' : 'frames'} at the end of the cut.`, 'ok', {
      label: 'Show board',
      run: () => navigate(projectPath(projectId, 'board')),
    })
  }

  // Ctrl+Alt+F: make frames from the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'f' && editor.isFocused) {
        e.preventDefault()
        makeFrames()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full flex-col">
      <Toolbar editor={editor} onLink={() => setLinkOpen(true)} onMedia={picker.open} onMakeFrames={makeFrames} />
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor.commands.focus('end')}>
        <div className="mx-auto max-w-[760px] px-8 pt-10 pb-32">
          <PageTitle
            pageId={pageId}
            value={page?.title ?? ''}
            placeholder={isFirst ? 'Notes' : 'Untitled'}
            onCommit={(title) => project.renamePage(pageId, title.trim())}
            onEnter={() => editor.commands.focus('start')}
          />
          <EditorContent editor={editor} />
        </div>
      </div>
      {picker.input}
      <LinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        hasSelection={!editor.state.selection.empty}
        current={editor.getAttributes('link').href as string | undefined}
        onSubmit={(url) => {
          if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
          else if (!editor.state.selection.empty) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          else insertLink(url, editor.state.selection.from)
        }}
      />
    </div>
  )
}

function PageTitle({
  pageId,
  value,
  placeholder,
  onCommit,
  onEnter,
}: {
  pageId: string
  value: string
  placeholder: string
  onCommit: (value: string) => void
  onEnter: () => void
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  useEffect(() => claimFocus(`[data-page-title="${pageId}"]`), [pageId])
  return (
    <input
      data-page-title={pageId}
      aria-label="Page title"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
          onEnter()
        }
      }}
      className="mb-4 w-full bg-transparent text-[28px] leading-tight font-semibold tracking-tight text-fg placeholder:text-fg-3 focus:outline-none"
    />
  )
}

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
  shortcut,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  shortcut?: string
}) {
  return (
    <IconButton
      size="sm"
      label={label}
      tooltip={
        shortcut ? (
          <span>
            {label} <Kbd>{shortcut}</Kbd>
          </span>
        ) : (
          label
        )
      }
      active={active}
      disabled={disabled}
      aria-pressed={active}
      // Keep the editor's selection while clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
  )
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

function Toolbar({
  editor,
  onLink,
  onMedia,
  onMakeFrames,
}: {
  editor: Editor
  onLink: () => void
  onMedia: () => void
  onMakeFrames: () => void
}) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      paragraph: e.isActive('paragraph'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      hasText: !e.state.selection.empty && selectedLines(e.state).length > 0,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const run = () => editor.chain().focus()
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-panel px-3" role="toolbar" aria-label="Formatting">
      <Tool label="Undo" shortcut="Ctrl Z" disabled={!st.canUndo} onClick={() => run().undo().run()}>
        <Undo2 size={15} />
      </Tool>
      <Tool label="Redo" shortcut="Ctrl Shift Z" disabled={!st.canRedo} onClick={() => run().redo().run()}>
        <Redo2 size={15} />
      </Tool>
      <Divider />
      <Tool label="Text" active={st.paragraph && !st.quote} onClick={() => run().setParagraph().run()}>
        <Pilcrow size={15} />
      </Tool>
      <Tool label="Heading" shortcut="Ctrl Alt 1" active={st.h1} onClick={() => run().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={15} />
      </Tool>
      <Tool label="Subheading" shortcut="Ctrl Alt 2" active={st.h2} onClick={() => run().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={15} />
      </Tool>
      <Tool label="Small heading" shortcut="Ctrl Alt 3" active={st.h3} onClick={() => run().toggleHeading({ level: 3 }).run()}>
        <Heading3 size={15} />
      </Tool>
      <Divider />
      <Tool label="Bold" shortcut="Ctrl B" active={st.bold} onClick={() => run().toggleBold().run()}>
        <Bold size={15} />
      </Tool>
      <Tool label="Italic" shortcut="Ctrl I" active={st.italic} onClick={() => run().toggleItalic().run()}>
        <Italic size={15} />
      </Tool>
      <Tool label="Strikethrough" active={st.strike} onClick={() => run().toggleStrike().run()}>
        <Strikethrough size={15} />
      </Tool>
      <Divider />
      <Tool label="Bulleted list" active={st.bullet} onClick={() => run().toggleBulletList().run()}>
        <List size={15} />
      </Tool>
      <Tool label="Numbered list" active={st.ordered} onClick={() => run().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </Tool>
      <Tool label="Quote" active={st.quote} onClick={() => run().toggleBlockquote().run()}>
        <TextQuote size={15} />
      </Tool>
      <Tool label="Divider" onClick={() => run().setHorizontalRule().run()}>
        <Minus size={15} />
      </Tool>
      <Divider />
      <Tool label={st.link ? 'Edit link' : 'Link or link card'} active={st.link} onClick={onLink}>
        <Link2 size={15} />
      </Tool>
      <Tool label="Picture, video or audio" onClick={onMedia}>
        <ImagePlus size={15} />
      </Tool>
      <div className="ml-auto pl-3">
        <Button
          size="sm"
          icon={<Clapperboard size={14} />}
          disabled={!st.hasText}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onMakeFrames}
          title="Each selected line or paragraph becomes a frame at the end of the cut (Ctrl+Alt+F)"
        >
          Make frames
        </Button>
      </div>
    </div>
  )
}

function LinkDialog({
  open,
  onOpenChange,
  hasSelection,
  current,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasSelection: boolean
  current: string | undefined
  onSubmit: (url: string) => void
}) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (open) setUrl(current ?? '')
  }, [open, current])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    const normalized = trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed
    onOpenChange(false)
    onSubmit(normalized)
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={hasSelection ? 'Link the selected text' : 'Add a link card'}
      description={hasSelection ? undefined : 'Shows the page’s title and picture. The link goes in the Library too.'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Web address" htmlFor="notes-link">
          <Input id="notes-link" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!url.trim() && !current}>
            {!url.trim() && current ? 'Remove link' : hasSelection ? 'Link' : 'Add card'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
