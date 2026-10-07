import { VIDEO_TARGETS, videoPrompt, videoPrompts, videoPromptsText, type VideoPrompt, type VideoPromptOptions, type VideoTarget } from '@weft/model'
import { Check, Copy, Download } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { copyText } from '../lib/copy'
import { cx } from '../lib/cx'
import { mediaUrl } from '../lib/media'
import { usePref } from '../lib/prefs'
import { toast } from '../lib/toast'
import { useSnapshot } from '../project/hooks'
import { Button, Modal, Segmented, textareaClass } from '../ui'

/**
 * Prompts for AI video tools (Google Flow, Higgsfield, and others), written
 * from what each frame already says, to copy into the tool.
 */

type Showing = { frameId: string } | { cut: true } | null

let showing: Showing = null
const listeners = new Set<() => void>()
function show(next: Showing): void {
  showing = next
  for (const listener of [...listeners]) listener()
}

/** Opens the video prompt for one frame. */
export const openVideoPrompt = (frameId: string) => show({ frameId })
/** Opens the video prompts for every shot in the cut. */
export const openCutPrompts = () => show({ cut: true })

function useShowing(): Showing {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => showing,
  )
}

/** Remembered on this computer: the tool, and what to put in. */
function useOptions(): [VideoPromptOptions, (patch: Partial<VideoPromptOptions>) => void] {
  const [raw, setRaw] = usePref('video-prompts')
  let options: VideoPromptOptions = { target: 'flow', dialogue: true, voiceover: false, tone: true }
  try {
    options = { ...options, ...(raw ? (JSON.parse(raw) as Partial<VideoPromptOptions>) : {}) }
  } catch {
    // Defaults, then.
  }
  return [options, (patch) => setRaw(JSON.stringify({ ...options, ...patch }))]
}

export function VideoPromptsHost({ cutId }: { cutId: string }) {
  const target = useShowing()
  const s = useSnapshot()
  useEffect(() => () => show(null), [])
  if (!target) return null
  if ('frameId' in target && !s.frames[target.frameId]) return null
  return (
    <Modal
      open
      onOpenChange={(open) => !open && show(null)}
      width={'frameId' in target ? 640 : 760}
      title={'frameId' in target ? 'Video prompt' : `Video prompts for ${s.cuts[cutId]?.name ?? 'this cut'}`}
      description={
        'frameId' in target
          ? "Written from the frame: what we see, the camera, who's in it (from the bible), its dialogue and the brief's tone. Edit it before you copy if you like."
          : "Written from each frame: what we see, the camera, who's in it (from the bible), its dialogue and the brief's tone. One clip per shot."
      }
    >
      {'frameId' in target ? <OnePrompt frameId={target.frameId} cutId={cutId} /> : <CutPrompts cutId={cutId} />}
    </Modal>
  )
}

function Options({ options, set }: { options: VideoPromptOptions; set: (patch: Partial<VideoPromptOptions>) => void }) {
  const hint = VIDEO_TARGETS.find((t) => t.id === options.target)?.hint
  return (
    <div className="flex flex-col gap-2">
      <Segmented<VideoTarget>
        label="Video tool"
        options={VIDEO_TARGETS.map((t) => ({ id: t.id, label: t.label, title: t.hint }))}
        value={options.target}
        onChange={(v) => v && set({ target: v })}
      />
      <p className="text-[12px] text-fg-3">{hint}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-2">
        <Toggle label="The brief's tone" checked={options.tone !== false} onChange={(v) => set({ tone: v })} />
        {options.target === 'flow' && (
          <>
            <Toggle label="Dialogue" checked={options.dialogue !== false} onChange={(v) => set({ dialogue: v })} />
            <Toggle label="Voice-over (usually recorded separately)" checked={!!options.voiceover} onChange={(v) => set({ voiceover: v })} />
          </>
        )}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

function CopyButton({ text, label = 'Copy', quiet }: { text: string; label?: string; quiet?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant={copied || quiet ? 'secondary' : 'primary'}
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onClick={() =>
        void copyText(text).then((ok) => {
          if (!ok) return toast("Couldn't copy here. Select the text and press Ctrl+C.", 'error')
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        })
      }
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

function Facts({ prompt }: { prompt: VideoPrompt }) {
  const s = useSnapshot()
  const start = prompt.startFrame ? s.assets[prompt.startFrame] : undefined
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
      <span>
        {prompt.seconds}s · {prompt.aspect}
      </span>
      {prompt.preset && (
        <span>
          Camera preset: <b className="font-medium text-fg">{prompt.preset}</b>
        </span>
      )}
      {start?.hash ? (
        <a href={mediaUrl(start.hash)} download={start.name || 'start-frame'} className="inline-flex items-center gap-1 font-medium text-fg-2 hover:text-fg hover:underline">
          <Download size={12} aria-hidden /> Start frame (the frame's picture)
        </a>
      ) : (
        <span>No picture to start from: text to video</span>
      )}
    </div>
  )
}

function OnePrompt({ frameId, cutId }: { frameId: string; cutId: string }) {
  const s = useSnapshot()
  const [options, set] = useOptions()
  const prompt = videoPrompt(s, frameId, cutId, options)
  const [text, setText] = useState(prompt.prompt)
  // Changing the tool or the options writes it afresh.
  useEffect(() => setText(prompt.prompt), [prompt.prompt])
  return (
    <div className="flex flex-col gap-4">
      <Options options={options} set={set} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-strong tabular-nums">{prompt.shot ?? '—'}</span>
          <Facts prompt={prompt} />
        </div>
        <textarea aria-label="Prompt" value={text} onChange={(e) => setText(e.target.value)} rows={7} className={cx(textareaClass, 'resize-y text-[13px] leading-[1.55]')} />
        {prompt.negative && (
          <p className="text-[12px] text-fg-3">
            Negative prompt: <span className="text-fg-2">{prompt.negative}</span>
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {prompt.negative && <CopyButton text={prompt.negative} label="Copy the negative" quiet />}
        <CopyButton text={text} label="Copy the prompt" />
      </div>
    </div>
  )
}

function CutPrompts({ cutId }: { cutId: string }) {
  const s = useSnapshot()
  const [options, set] = useOptions()
  const prompts = videoPrompts(s, cutId, options)
  return (
    <div className="flex flex-col gap-4">
      <Options options={options} set={set} />
      {prompts.length ? (
        <ol className="flex max-h-[48vh] flex-col gap-3 overflow-y-auto pr-1">
          {prompts.map((p) => (
            <li key={p.frameId} className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-strong tabular-nums">{p.shot ?? '—'}</span>
                <Facts prompt={p} />
                <span className="ml-auto">
                  <CopyButton text={p.prompt} quiet />
                </span>
              </div>
              <p className="text-[13px] leading-[1.5] text-fg">{p.prompt}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-fg-2">This cut has no shots yet.</p>
      )}
      <div className="flex justify-end">
        <CopyButton text={videoPromptsText(prompts)} label="Copy them all" />
      </div>
    </div>
  )
}
