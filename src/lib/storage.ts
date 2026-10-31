// Local-only library of recordings kept in IndexedDB. Nothing is uploaded anywhere.
import { openDB, type DBSchema } from 'idb'
import type { Mode } from './settings'

export interface RecordingMeta {
  id: string
  name: string
  createdAt: number
  durationMs: number
  size: number
  mimeType: string
  mode: Mode
  width?: number
  height?: number
  thumbnail?: Blob
  /** True when the media lives in a file on disk rather than in the browser. */
  onDisk?: boolean
  diskName?: string
}

interface ReelDB extends DBSchema {
  recordings: { key: string; value: RecordingMeta; indexes: { createdAt: number } }
  media: { key: string; value: { id: string; blob?: Blob; handle?: FileSystemFileHandle } }
  handles: { key: string; value: FileSystemHandle }
}

const dbPromise = openDB<ReelDB>('reel', 1, {
  upgrade(db) {
    db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
    db.createObjectStore('media', { keyPath: 'id' })
    db.createObjectStore('handles')
  },
})

export async function saveRecording(meta: RecordingMeta, media: { blob?: Blob; handle?: FileSystemFileHandle }) {
  const db = await dbPromise
  const tx = db.transaction(['recordings', 'media'], 'readwrite')
  await Promise.all([tx.objectStore('recordings').put(meta), tx.objectStore('media').put({ id: meta.id, ...media }), tx.done])
}

export async function updateRecording(id: string, patch: Partial<RecordingMeta>) {
  const db = await dbPromise
  const meta = await db.get('recordings', id)
  if (meta) await db.put('recordings', { ...meta, ...patch })
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await dbPromise
  return (await db.getAllFromIndex('recordings', 'createdAt')).reverse()
}

export async function getRecording(id: string) {
  return (await dbPromise).get('recordings', id)
}

/** Loads the media for a recording; files on disk may need a permission prompt (call from a click). */
export async function loadMedia(id: string): Promise<Blob | null> {
  const entry = await (await dbPromise).get('media', id)
  if (!entry) return null
  if (entry.blob) return entry.blob
  if (entry.handle) {
    const h = entry.handle
    if ((await h.queryPermission?.({ mode: 'read' })) !== 'granted') {
      if ((await h.requestPermission?.({ mode: 'read' })) !== 'granted') return null
    }
    return h.getFile()
  }
  return null
}

export async function deleteRecording(id: string) {
  const db = await dbPromise
  const tx = db.transaction(['recordings', 'media'], 'readwrite')
  await Promise.all([tx.objectStore('recordings').delete(id), tx.objectStore('media').delete(id), tx.done])
}

export async function getHandle<T extends FileSystemHandle>(key: string): Promise<T | undefined> {
  return (await (await dbPromise).get('handles', key)) as T | undefined
}

export async function setHandle(key: string, handle: FileSystemHandle | null) {
  const db = await dbPromise
  if (handle) await db.put('handles', handle, key)
  else await db.delete('handles', key)
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* best effort */
  }
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
