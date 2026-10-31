// Trims a recording by playing the chosen range through a MediaRecorder.
// Runs in real time but needs no server or heavy WASM encoder; output is silent to the speakers.
import fixWebmDuration from 'fix-webm-duration'
import { closeContext } from './audio'
import { pickMimeType } from './recorder'
import type { Format } from './settings'

export interface TrimJob {
  promise: Promise<{ blob: Blob; durationMs: number; mimeType: string }>
  cancel: () => void
}

export function trimRecording(
  source: Blob,
  startSec: number,
  endSec: number,
  format: Format,
  isAudio: boolean,
  onProgress: (fraction: number) => void,
): TrimJob {
  let cancelled = false
  let cleanup = () => {}
  const promise = new Promise<{ blob: Blob; durationMs: number; mimeType: string }>((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const v = document.createElement('video')
    v.src = url
    v.preload = 'auto'
    v.playsInline = true
    const actx = new AudioContext()
    const dest = actx.createMediaStreamDestination()
    let rec: MediaRecorder | null = null
    let timer = 0

    cleanup = () => {
      clearInterval(timer)
      v.pause()
      if (rec && rec.state !== 'inactive') rec.stop()
      URL.revokeObjectURL(url)
      closeContext(actx)
    }

    v.addEventListener('error', () => {
      cleanup()
      reject(new Error('Could not read the recording for trimming.'))
    })

    v.addEventListener(
      'loadedmetadata',
      async () => {
        try {
          actx.createMediaElementSource(v).connect(dest)
          const capture = v.captureStream?.() ?? v.mozCaptureStream?.()
          if (!capture) throw new Error('This browser cannot re-encode video (captureStream unsupported).')
          const stream = new MediaStream([...(isAudio ? [] : capture.getVideoTracks()), ...dest.stream.getAudioTracks()])
          const mimeType = pickMimeType(format, isAudio ? 'audio' : 'video')
          const chunks: Blob[] = []
          rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 8_000_000 })
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
          rec.onstop = async () => {
            if (cancelled) return
            const type = (rec!.mimeType || mimeType).split(';')[0]
            const durationMs = (endSec - startSec) * 1000
            let blob = new Blob(chunks, { type })
            if (type.includes('webm')) blob = await fixWebmDuration(blob, durationMs, { logger: false })
            resolve({ blob, durationMs, mimeType: rec!.mimeType || mimeType })
          }
          v.currentTime = startSec
          await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
          await actx.resume()
          rec.start(1000)
          await v.play()
          timer = window.setInterval(() => {
            onProgress(Math.min(1, (v.currentTime - startSec) / (endSec - startSec)))
            if (v.currentTime >= endSec || v.ended) {
              clearInterval(timer)
              v.pause()
              rec?.stop()
              URL.revokeObjectURL(url)
              closeContext(actx)
            }
          }, 50)
        } catch (e) {
          cleanup()
          reject(e)
        }
      },
      { once: true },
    )
  })
  return {
    promise,
    cancel: () => {
      cancelled = true
      cleanup()
    },
  }
}
