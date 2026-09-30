const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

export const log = {
  info: (message: string) => console.log(`${time()}  ${message}`),
  warn: (message: string) => console.warn(`${time()}  warn  ${message}`),
  error: (message: string, error?: unknown) => console.error(`${time()}  error ${message}`, error ?? ''),
}
