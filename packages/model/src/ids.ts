const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Short random id, safe to create on any client without coordination. */
export function newId(size = 12): string {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
  return id
}

let lastTimestamp = 0

/**
 * Milliseconds since epoch, strictly increasing within this client, so items
 * created in one burst keep their creation order.
 */
export function timestamp(): number {
  const now = Date.now()
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1
  return lastTimestamp
}
