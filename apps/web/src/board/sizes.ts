import { aspectValue, type AspectRatio } from '@weft/model'

export interface CardSize {
  width: number
  imageHeight: number
  height: number
}

/** Height of everything below the image: meta row, description, VO, references. */
const CHROME_HEIGHT = 156

const WIDTHS: Record<AspectRatio, number> = {
  '16:9': 248,
  '2.39:1': 272,
  '1:1': 212,
  '4:5': 200,
  '9:16': 180,
}

export function cardSize(aspect: AspectRatio): CardSize {
  const width = WIDTHS[aspect]
  const imageHeight = Math.round(width / aspectValue(aspect))
  return { width, imageHeight, height: imageHeight + CHROME_HEIGHT }
}

/** Wide enough for a link label ("0:14 · Dissolve") between cards. */
export const GAP_X = 104
export const GAP_Y = 64
