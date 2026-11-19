// Scans an editor clip for objects with ml5.js, so chosen kinds can be removed from it.
import { CleanPlate, detectObjects, loadDetector } from '../lib/objects'
import type { ClipObjects, MediaClip } from './types'

/** Samples per second of video while scanning. */
const RATE = 3

export interface ScanJob {
  promise: Promise<{ objects: ClipObjects; plate: CleanPlate }>
  cancel: () => void
}

export function scanClip(url: string, clip: MediaClip, onProgress: (f: number) => void): ScanJob {
  let cancelled = false
  const promise = (async () => {
    const detector = await loadDetector()
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.playsInline = true
    v.src = url
    await new Promise((resolve, reject) => {
      v.addEventListener('loadeddata', resolve, { once: true })
      v.addEventListener('error', () => reject(new Error('Could not read this clip.')), { once: true })
    })
    const plate = new CleanPlate()
    const samples: ClipObjects['samples'] = []
    const counts = new Map<string, number>()
    const steps = Math.max(1, Math.ceil(clip.duration * RATE))
    try {
      for (let i = 0; i <= steps; i++) {
        if (cancelled) throw new Error('cancelled')
        const t = clip.in + Math.min(clip.duration - 0.05, i / RATE)
        await new Promise((r) => {
          v.addEventListener('seeked', r, { once: true })
          setTimeout(r, 1500)
          v.currentTime = t
        })
        const found = await detectObjects(detector, v, v.videoWidth, v.videoHeight)
        samples.push({ t, objs: found.map((d) => ({ label: d.label, box: d.box, score: d.score })) })
        plate.update(v, v.videoWidth, v.videoHeight, found.map((d) => d.box), 0.35)
        // Count how many samples each kind shows up in, to rank them.
        for (const l of new Set(found.map((d) => d.label))) counts.set(l, (counts.get(l) ?? 0) + 1)
        onProgress(i / steps)
      }
    } finally {
      v.removeAttribute('src')
      v.load()
    }
    const labels = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    return { objects: { samples, labels, remove: clip.objects?.remove ?? [] }, plate }
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
    },
  }
}
