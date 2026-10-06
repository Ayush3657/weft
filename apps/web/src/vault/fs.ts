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

/** Everything directly inside a folder, read in one go (so the folder can change while you go through it). */
export async function entries(dir: FileSystemDirectoryHandle): Promise<Array<[string, FileSystemHandle]>> {
  const out: Array<[string, FileSystemHandle]> = []
  for await (const entry of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) out.push(entry)
  return out
}

type Movable = FileSystemFileHandle & { move?: (to: FileSystemDirectoryHandle, name: string) => Promise<void> }

/** Moves everything in `from` into `to`. Files move in place where the browser can (fast, even for big videos), otherwise they're copied. */
async function moveInto(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> {
  for (const [name, entry] of await entries(from)) {
    if (entry.kind === 'directory') {
      const sub = await to.getDirectoryHandle(name, { create: true })
      await moveInto(entry as FileSystemDirectoryHandle, sub)
      await removeEmpty(from, name)
      continue
    }
    const file = entry as Movable
    let moved = false
    if (typeof file.move === 'function') {
      try {
        await file.move(to, name)
        moved = true
      } catch {
        // Some places (another drive, say) can't move files: copy instead.
      }
    }
    if (!moved) {
      await writeFile(to, name, await file.getFile())
      await from.removeEntry(name)
    }
  }
}

/** Removes a folder only if nothing is left in it, so a move that fell short never deletes anything. */
async function removeEmpty(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
  const dir = await parent.getDirectoryHandle(name)
  const left = await entries(dir)
  if (left.length) throw new Error(`Couldn't move everything out of “${name}”; ${left.length} ${left.length === 1 ? 'thing is' : 'things are'} still there.`)
  await parent.removeEntry(name)
}

/**
 * Moves (or renames) the folder `name` in `parent` to `newName` in `to`, and
 * returns it there. Browsers can't move a folder in one go, so it's made anew
 * and filled. A new name that only differs in capitals (the same folder, on
 * Windows) goes through a temporary name.
 */
export async function moveFolder(parent: FileSystemDirectoryHandle, name: string, to: FileSystemDirectoryHandle, newName: string): Promise<FileSystemDirectoryHandle> {
  const source = await parent.getDirectoryHandle(name)
  const there = await folderIn(to, newName, false)
  if (there && (await there.isSameEntry(source))) {
    if (name === newName) return source
    const temporary = `${newName}.weft-moving`
    await moveFolder(parent, name, to, temporary)
    return moveFolder(to, temporary, to, newName)
  }
  if (there) throw new Error(`There's already a folder called “${newName}” there`)
  const target = await to.getDirectoryHandle(newName, { create: true })
  await moveInto(source, target)
  await removeEmpty(parent, name)
  return target
}
