import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Project, initProject, videoPrompt, videoPrompts, videoPromptsText } from '../src'

function setup() {
  const doc = new Y.Doc()
  const { firstFrameId, mainCutId } = initProject(doc, { title: 'Broadway launch', type: 'ad', targetDuration: 30 })
  const p = new Project(doc)
  p.setText(firstFrameId, 'description', 'Priya opens the door to her new living room, morning light pouring in')
  p.updateFrame(firstFrameId, { shotSize: 'mcu', angle: 'low', movement: 'push-in', lens: '35mm' })
  p.setDuration(firstFrameId, 4)
  const priya = p.createBibleEntry('character', { name: 'Priya', description: 'A woman in her thirties, linen kurta, warm smile' })
  p.toggleFrameTag(firstFrameId, priya)
  p.setVo(firstFrameId, 'Some homes you buy. Some you come home to.')
  p.addAudioLine(firstFrameId, { kind: 'dialogue', speaker: 'Priya', text: 'Welcome home.' })
  p.briefText('tone').insert(0, 'Warm, confident, never shouty')
  const second = p.appendFrame(mainCutId, { description: 'The clubhouse pool at dusk', durationMode: 'manual', duration: 3 })
  return { p, first: firstFrameId, second, cut: mainCutId }
}

describe('video prompts', () => {
  it('writes a Flow prompt the way Veo likes it: camera, action, cast, move, tone, then sound', () => {
    const { p, first, cut } = setup()
    const out = videoPrompt(p.snapshot(), first, cut, { target: 'flow' })
    expect(out.prompt).toBe(
      'Medium close-up shot, low angle, on a 35mm lens. Priya opens the door to her new living room, morning light pouring in. ' +
        'In the shot: Priya (A woman in her thirties, linen kurta, warm smile). The camera slowly pushes in. ' +
        'Tone and look: Warm, confident, never shouty. Priya says: "Welcome home." ' +
        'Audio: the voices, with natural ambient sound; no music. No subtitles or on-screen text.',
    )
    expect(out).toMatchObject({ shot: '1', seconds: 4, aspect: '16:9', negative: null, preset: null })
    // The voice-over is usually recorded separately, so it's left out unless asked for.
    expect(videoPrompt(p.snapshot(), first, cut, { target: 'flow', voiceover: true }).prompt).toContain('Voice-over: "Some homes you buy. Some you come home to."')
  })

  it("gives Higgsfield a camera preset instead of a camera sentence", () => {
    const { p, first, cut } = setup()
    const out = videoPrompt(p.snapshot(), first, cut, { target: 'higgsfield' })
    expect(out.preset).toBe('Dolly In')
    expect(out.prompt).not.toContain('pushes in')
    expect(out.prompt).toContain('Framing: Medium close-up shot, low angle, on a 35mm lens.')
    expect(out.prompt).not.toContain('says:')
  })

  it('gives other tools a length, a shape and a negative prompt', () => {
    const { p, second, cut } = setup()
    const out = videoPrompt(p.snapshot(), second, cut, { target: 'generic' })
    expect(out.prompt).toBe('The clubhouse pool at dusk. Tone and look: Warm, confident, never shouty. 3 seconds, 16:9.')
    expect(out.negative).toContain('subtitles')
  })

  it("covers a whole cut, in order, numbered by shot", () => {
    const { p, cut } = setup()
    const all = videoPrompts(p.snapshot(), cut, { target: 'higgsfield', tone: false })
    expect(all.map((x) => x.shot)).toEqual(['1', '2'])
    const text = videoPromptsText(all)
    expect(text.startsWith('Shot 1 (4s) · camera preset: Dolly In\n')).toBe(true)
    expect(text).toContain('\n\nShot 2 (3s) · camera preset: General\nThe clubhouse pool at dusk.')
  })
})
