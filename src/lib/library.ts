import { makeThumbnail } from './thumbnail'
import { newId, saveRecording, type RecordingMeta } from './storage'
import type { Mode } from './settings'

export interface OpenRecording {
  meta: RecordingMeta
  blob: Blob
  /** False when the user opted out of the in-browser library and this exists only in memory. */
  stored: boolean
}

export async function persistRecording(
  input: { blob: Blob; durationMs: number; mimeType: string; fileHandle?: FileSystemFileHandle },
  name: string,
  mode: Mode,
  keepInLibrary: boolean,
): Promise<OpenRecording> {
  const isVideo = !input.mimeType.startsWith('audio')
  const thumb = isVideo ? await makeThumbnail(input.blob) : {}
  const meta: RecordingMeta = {
    id: newId(),
    name,
    createdAt: Date.now(),
    durationMs: input.durationMs,
    size: input.blob.size,
    mimeType: input.mimeType,
    mode,
    ...thumb,
    onDisk: !!input.fileHandle,
    diskName: input.fileHandle?.name,
  }
  // Files already on disk are referenced by handle, so the library never duplicates them.
  const stored = keepInLibrary || !!input.fileHandle
  if (stored) await saveRecording(meta, input.fileHandle ? { handle: input.fileHandle } : { blob: input.blob })
  return { meta, blob: input.blob, stored }
}
