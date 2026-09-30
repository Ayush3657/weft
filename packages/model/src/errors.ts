export type WeftErrorCode = 'not-found' | 'cycle' | 'invalid'

export class WeftError extends Error {
  readonly code: WeftErrorCode

  constructor(code: WeftErrorCode, message: string) {
    super(message)
    this.name = 'WeftError'
    this.code = code
  }
}
