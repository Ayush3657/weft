/**
 * Small helpers over the browser's File System Access API (Chrome and Edge),
 * which lets Weft read and write a folder the person picks.
 */

export const vaultSupported = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window

type Mode = { mode: 'readwrite' }
const READWRITE: Mode = { mode: 'readwrite' }

/** Whether Weft may write to the folder. Asking needs a click (a user gesture) in browsers. */
export async function folderPermission(dir: FileSystemDirectoryHandle, ask: boolean): Promise<PermissionState> {
  const handle = dir as FileSystemDirectoryHandle & {
    queryPermission?: (d: Mode) => Promise<PermissionState>
    requestPermission?: (d: Mode) => Promise<PermissionState>
  }
  const current = (await handle.queryPermission?.(READWRITE)) ?? 'granted'
  if (current === 'granted' || !ask) return current
  return (await handle.requestPermission?.(READWRITE)) ?? 'denied'
}

export function pickFolder(id: string): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
  return picker({ id, mode: 'readwrite', startIn: 'documents' })
}

const isMissing = (error: unknown) => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')

export async function fileIn(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function folderIn(dir: FileSystemDirectoryHandle, name: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dir.getDirectoryHandle(name, { create })
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/** Writes a whole file. The browser writes to a temporary copy and swaps it in, so readers never see half a file. */
export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: string | Blob | BufferSource | ReadableStream<Uint8Array>): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  if (data instanceof ReadableStream) {
    await data.pipeTo(writable)
    return
  }
  try {
    await writable.write(data)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

export async function removeFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  await dir.removeEntry(name).catch((error: unknown) => {
    if (!isMissing(error)) throw error
  })
}

/** Names of the files (not folders) directly inside a folder. */
export async function fileNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const [name, entry] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind === 'file') names.push(name)
  }
  return names
}

/** The folders directly inside a folder. */
export async function subfolders(dir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle[]> {
  const out: FileSystemDirectoryHandle[] = []
  for await (const [, entry] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind === 'directory') out.push(entry as FileSystemDirectoryHandle)
  }
  return out
}
