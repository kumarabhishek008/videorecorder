// Saving recordings to the user's own drives.
import { getHandle, setHandle } from './storage'

export const canPickFiles = typeof window !== 'undefined' && !!window.showSaveFilePicker
export const canPickFolders = typeof window !== 'undefined' && !!window.showDirectoryPicker

const SAVE_DIR_KEY = 'saveDir'

function acceptFor(mime: string, ext: string): FilePickerAcceptType[] {
  const type = mime.split(';')[0]
  return [{ description: type.startsWith('audio') ? 'Audio' : type.startsWith('image') ? 'Image' : 'Video', accept: { [type]: [`.${ext}`] } }]
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * "Save as…" dialog where supported (Chrome/Edge), otherwise a regular download.
 * Returns false if the user cancelled the dialog.
 */
export async function saveBlobAs(blob: Blob, fileName: string, ext: string): Promise<boolean> {
  if (!window.showSaveFilePicker) {
    downloadBlob(blob, fileName)
    return true
  }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: acceptFor(blob.type, ext), id: 'reel-save' })
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
    return true
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return false
    throw e
  }
}

export async function pickSaveFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    const dir = await window.showDirectoryPicker({ id: 'reel-folder', mode: 'readwrite', startIn: 'videos' })
    await setHandle(SAVE_DIR_KEY, dir)
    return dir
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null
    throw e
  }
}

export const getSaveFolder = () => getHandle<FileSystemDirectoryHandle>(SAVE_DIR_KEY)
export const clearSaveFolder = () => setHandle(SAVE_DIR_KEY, null)

/** Checks (and if `prompt`, requests) write access. Requesting needs a recent user click. */
export async function ensureWriteAccess(dir: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' as const }
  if ((await dir.queryPermission?.(opts)) === 'granted') return true
  if (!prompt) return false
  try {
    return (await dir.requestPermission?.(opts)) === 'granted'
  } catch {
    return false
  }
}

async function uniqueName(dir: FileSystemDirectoryHandle, base: string, ext: string): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const name = i ? `${base} (${i}).${ext}` : `${base}.${ext}`
    try {
      await dir.getFileHandle(name)
    } catch {
      return name
    }
  }
  return `${base}-${Date.now()}.${ext}`
}

export async function createFileInFolder(dir: FileSystemDirectoryHandle, base: string, ext: string) {
  const name = await uniqueName(dir, base, ext)
  return dir.getFileHandle(name, { create: true })
}

export async function saveToFolder(dir: FileSystemDirectoryHandle, blob: Blob, base: string, ext: string): Promise<string> {
  const handle = await createFileInFolder(dir, base, ext)
  const w = await handle.createWritable()
  await w.write(blob)
  await w.close()
  return handle.name
}
