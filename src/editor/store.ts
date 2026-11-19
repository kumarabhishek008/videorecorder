// Editor projects and their media, saved in this browser (IndexedDB). Nothing is uploaded.
import { openDB, type DBSchema } from 'idb'
import { newId } from '../lib/storage'
import type { Asset, AssetKind, Project } from './types'

interface EditorDB extends DBSchema {
  projects: { key: string; value: Project }
  blobs: { key: string; value: Blob }
}

const dbPromise = openDB<EditorDB>('reel-editor', 1, {
  upgrade(db) {
    db.createObjectStore('projects', { keyPath: 'id' })
    db.createObjectStore('blobs')
  },
})

export function newProject(name = 'Untitled project'): Project {
  const v1 = { id: newId(), kind: 'video' as const, name: 'Video 1', muted: false, hidden: false }
  return {
    id: newId(),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#000000',
    tracks: [
      { id: newId(), kind: 'text', name: 'Text 1', muted: false, hidden: false },
      { id: newId(), kind: 'video', name: 'Video 2', muted: false, hidden: false },
      v1,
      { id: newId(), kind: 'audio', name: 'Audio 1', muted: false, hidden: false },
      { id: newId(), kind: 'audio', name: 'Audio 2', muted: false, hidden: false },
    ],
    clips: [],
    assets: [],
    luts: [],
    updatedAt: Date.now(),
  }
}

export async function saveProject(p: Project) {
  await (await dbPromise).put('projects', { ...p, updatedAt: Date.now() })
}

export async function loadProject(id: string) {
  return (await dbPromise).get('projects', id)
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await dbPromise).getAll('projects')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(p: Project) {
  const db = await dbPromise
  const tx = db.transaction(['projects', 'blobs'], 'readwrite')
  await Promise.all([tx.objectStore('projects').delete(p.id), ...p.assets.map((a) => tx.objectStore('blobs').delete(a.id)), ...p.luts.map((l) => tx.objectStore('blobs').delete(l.id)), tx.done])
}

export async function putBlob(id: string, blob: Blob) {
  await (await dbPromise).put('blobs', blob, id)
}

export async function getBlob(id: string) {
  return (await dbPromise).get('blobs', id)
}

export function kindOf(type: string): AssetKind | null {
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('image/')) return 'image'
  return null
}

/** Reads length and size of a media file. MediaRecorder WebM without a duration header is handled. */
export async function probeMedia(blob: Blob, kind: AssetKind): Promise<Pick<Asset, 'duration' | 'width' | 'height' | 'hasAudio'>> {
  const url = URL.createObjectURL(blob)
  try {
    if (kind === 'image') {
      const img = new Image()
      img.src = url
      await img.decode()
      return { duration: 5, width: img.naturalWidth, height: img.naturalHeight }
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    el.preload = 'metadata'
    el.muted = true
    el.src = url
    await new Promise((resolve, reject) => {
      el.addEventListener('loadedmetadata', resolve, { once: true })
      el.addEventListener('error', () => reject(new Error('This file could not be opened.')), { once: true })
    })
    let duration = el.duration
    if (!Number.isFinite(duration)) {
      // Seeking far ahead makes the browser work out the real length.
      el.currentTime = 1e7
      await new Promise((r) => el.addEventListener('durationchange', r, { once: true }))
      duration = el.duration
    }
    const v = el as HTMLVideoElement
    const anyEl = el as HTMLMediaElement & { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number; audioTracks?: { length: number } }
    return {
      duration: Number.isFinite(duration) ? duration : 0,
      width: kind === 'video' ? v.videoWidth : undefined,
      height: kind === 'video' ? v.videoHeight : undefined,
      hasAudio: kind === 'audio' ? true : anyEl.audioTracks ? anyEl.audioTracks.length > 0 : anyEl.mozHasAudio ?? true,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
