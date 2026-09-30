import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../lib/toast'

export type RecorderState =
  | { status: 'idle' }
  | { status: 'recording'; frameId: string; startedAt: number }
  | { status: 'saving'; frameId: string }

interface Session {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  frameId: string
  startedAt: number
}

/**
 * Records scratch VO from the microphone, one frame at a time. The length is
 * measured while recording because browsers often leave it out of the file.
 */
export function useVoRecorder(onRecorded: (frameId: string, file: File, seconds: number) => Promise<void>) {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const session = useRef<Session | null>(null)
  const latest = useRef(onRecorded)
  latest.current = onRecorded

  const start = useCallback(async (frameId: string): Promise<boolean> => {
    if (session.current) return false
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast('Recording needs a secure address (https, or localhost on this PC).', 'error')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.start()
      session.current = { recorder, stream, chunks, frameId, startedAt: performance.now() }
      setState({ status: 'recording', frameId, startedAt: Date.now() })
      return true
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      toast(denied ? 'Allow microphone access to record VO.' : "Couldn't start the microphone.", 'error')
      return false
    }
  }, [])

  const stop = useCallback(() => {
    const current = session.current
    if (!current) return
    session.current = null
    const seconds = (performance.now() - current.startedAt) / 1000
    setState({ status: 'saving', frameId: current.frameId })
    current.recorder.onstop = async () => {
      for (const track of current.stream.getTracks()) track.stop()
      const type = (current.recorder.mimeType || 'audio/webm').split(';')[0]!
      const file = new File(current.chunks, `vo-${Date.now()}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type })
      try {
        if (seconds >= 0.3) await latest.current(current.frameId, file, seconds)
      } catch (error) {
        toast(error instanceof Error ? error.message : "Couldn't save the recording", 'error')
      } finally {
        setState({ status: 'idle' })
      }
    }
    current.recorder.stop()
  }, [])

  useEffect(
    () => () => {
      const current = session.current
      if (!current) return
      current.recorder.onstop = null
      if (current.recorder.state !== 'inactive') current.recorder.stop()
      for (const track of current.stream.getTracks()) track.stop()
    },
    [],
  )

  return { state, start, stop }
}
