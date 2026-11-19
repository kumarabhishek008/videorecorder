// Pictures uploaded as camera backgrounds. Kept in their own IndexedDB database on this device.
import { openDB, type DBSchema } from 'idb'
import { newId } from './storage'

export interface StoredBackground {
  id: string
  name: string
  createdAt: number
  blob: Blob
}

interface BackgroundDB extends DBSchema {
  backgrounds: { key: string; value: StoredBackground }
}

const dbPromise = openDB<BackgroundDB>('reel-backgrounds', 1, {
  upgrade(db) {
    db.createObjectStore('backgrounds', { keyPath: 'id' })
  },
})

/** Largest side of a stored picture; plenty for a camera background and keeps storage small. */
const MAX_SIDE = 1920

export async function listBackgrounds(): Promise<StoredBackground[]> {
  const all = await (await dbPromise).getAll('backgrounds')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getBackground(id: string): Promise<StoredBackground | undefined> {
  return (await dbPromise).get('backgrounds', id)
}

/** Resizes the picture if it's large, stores it and returns the saved entry. Throws for files that aren't images. */
export async function addBackground(file: File): Promise<StoredBackground> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read this image.'))), 'image/jpeg', 0.9),
  )
  const entry: StoredBackground = { id: newId(), name: file.name.replace(/\.[^.]+$/, ''), createdAt: Date.now(), blob }
  await (await dbPromise).put('backgrounds', entry)
  return entry
}

export async function deleteBackground(id: string) {
  await (await dbPromise).delete('backgrounds', id)
}
