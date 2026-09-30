import { NotebookPen, Play } from 'lucide-react'
import { navigate, projectPath } from '../lib/router'
import { Button } from '../ui'

const COPY = {
  write: {
    icon: NotebookPen,
    title: 'Write is coming next',
    body: 'Notes, the AV script (each row becomes a frame), the project bible with cast and locations, and the moodboard.',
  },
  play: {
    icon: Play,
    title: 'Play is coming next',
    body: 'Your cut as an animatic: the frame list on the left, the preview on the right, and a timeline with VO and music tracks.',
  },
} as const

export function WorkspacePlaceholder({ workspace, projectId }: { workspace: 'write' | 'play'; projectId: string }) {
  const { icon: Icon, title, body } = COPY[workspace]
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <Icon size={20} aria-hidden />
        </span>
        <h1 className="mt-4 text-[16px] font-semibold text-fg">{title}</h1>
        <p className="mt-1.5 text-fg-2">{body}</p>
        <Button className="mt-5" onClick={() => navigate(projectPath(projectId, 'board'))}>
          Go to the board
        </Button>
      </div>
    </div>
  )
}
