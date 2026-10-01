/**
 * Remembers folders between visits. Folder handles can't go in localStorage,
 * but IndexedDB keeps them, in this browser only.
 */

const DB = 'weft-vault'
const STORE = 'folders'

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the browser's storage"))
  })
  return opening
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await db()
  return new Promise<T>((resolve, reject) => {
    const req = act(database.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error ?? new Error("Couldn't use the browser's storage"))
  })
}

export const getStored = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key))
export const putStored = (key: string, value: unknown) => run<IDBValidKey>('readwrite', (s) => s.put(value, key))
export const deleteStored = (key: string) => run<undefined>('readwrite', (s) => s.delete(key))

/** A project's own folder, or how it sits in the vault. */
export interface ProjectFolderRecord {
  /** A folder picked for this project (or opened from), rather than one inside the vault. */
  folder?: FileSystemDirectoryHandle
  /** Name of the project's folder inside the vault, fixed once made so renaming the project doesn't move it. */
  name?: string
  /** Don't keep this project in the vault. */
  off?: boolean
  /** The folder was opened on purpose, so its contents count as this project even if its saved id differs. */
  adopt?: boolean
}

export const VAULT_KEY = 'vault'
export const projectKey = (projectId: string) => `project:${projectId}`
