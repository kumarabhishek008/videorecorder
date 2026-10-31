import fixWebmDuration from 'fix-webm-duration'
import type { Format, Quality } from './settings'

const CANDIDATES = {
  video: {
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm'],
    mp4: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'],
  },
  audio: {
    webm: ['audio/webm;codecs=opus', 'audio/webm'],
    mp4: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
  },
}

const supported = (t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)

export function supportedFormats(): Record<Format, boolean> {
  return {
    webm: CANDIDATES.video.webm.some(supported),
    mp4: CANDIDATES.video.mp4.some(supported),
  }
}

export function pickMimeType(format: Format, kind: 'video' | 'audio'): string {
  const order: Format[] = format === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4']
  for (const f of order) {
    const t = CANDIDATES[kind][f].find(supported)
    if (t) return t
  }
  return ''
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return mimeType.startsWith('audio') ? 'm4a' : 'mp4'
  return mimeType.startsWith('audio') ? 'weba' : 'webm'
}

const BITS_PER_PIXEL: Record<Quality, number> = { low: 0.04, standard: 0.08, high: 0.14, max: 0.22 }

export function videoBitrate(width: number, height: number, fps: number, q: Quality): number {
  return Math.round(Math.min(60_000_000, Math.max(1_000_000, width * height * fps * BITS_PER_PIXEL[q])))
}

export interface RecordingResult {
  blob: Blob
  durationMs: number
  mimeType: string
  /** Set when the recording was streamed straight to a file on disk. */
  fileHandle?: FileSystemFileHandle
}

export interface RecorderOptions {
  mimeType: string
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
  /** Stream chunks into this file as they arrive instead of holding them in memory. */
  file?: FileSystemFileHandle
}

export class Recorder {
  private rec: MediaRecorder
  private chunks: Blob[] = []
  private writable: FileSystemWritableFileStream | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private startedAt = 0
  private pausedAt = 0
  private pausedTotal = 0
  bytes = 0
  onError: ((e: unknown) => void) | null = null

  constructor(
    stream: MediaStream,
    private opts: RecorderOptions,
  ) {
    this.rec = new MediaRecorder(stream, {
      mimeType: opts.mimeType || undefined,
      videoBitsPerSecond: opts.videoBitsPerSecond,
      audioBitsPerSecond: opts.audioBitsPerSecond,
    })
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return
      this.bytes += e.data.size
      if (this.writable) {
        const w = this.writable
        this.writeQueue = this.writeQueue.then(() => w.write(e.data)).catch((err) => this.onError?.(err))
      } else {
        this.chunks.push(e.data)
      }
    }
    this.rec.onerror = (e) => this.onError?.((e as unknown as { error?: unknown }).error ?? e)
  }

  get state() {
    return this.rec.state
  }

  get mimeType() {
    return this.rec.mimeType || this.opts.mimeType
  }

  async start() {
    if (this.opts.file) this.writable = await this.opts.file.createWritable()
    this.startedAt = performance.now()
    this.rec.start(1000)
  }

  pause() {
    if (this.rec.state !== 'recording') return
    this.rec.pause()
    this.pausedAt = performance.now()
  }

  resume() {
    if (this.rec.state !== 'paused') return
    this.rec.resume()
    this.pausedTotal += performance.now() - this.pausedAt
    this.pausedAt = 0
  }

  /** Recorded time, excluding pauses. */
  elapsed(): number {
    if (!this.startedAt) return 0
    const end = this.pausedAt || performance.now()
    return end - this.startedAt - this.pausedTotal
  }

  async stop(): Promise<RecordingResult> {
    const durationMs = this.elapsed()
    if (this.rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.rec.addEventListener('stop', () => resolve(), { once: true })
        this.rec.stop()
      })
    }
    const mimeType = this.mimeType
    const type = mimeType.split(';')[0]
    const isWebm = type.includes('webm')

    if (this.writable && this.opts.file) {
      await this.writeQueue
      await this.writable.close()
      this.writable = null
      let file: Blob = await this.opts.file.getFile()
      // MediaRecorder WebM has no duration header, which breaks seeking. Patch it when the file is a sane size.
      if (isWebm && file.size < 1.5 * 1024 ** 3) {
        const fixed = await fixWebmDuration(file, durationMs, { logger: false })
        const w = await this.opts.file.createWritable()
        await w.write(fixed)
        await w.close()
        file = await this.opts.file.getFile()
      }
      return { blob: file, durationMs, mimeType, fileHandle: this.opts.file }
    }

    let blob = new Blob(this.chunks, { type })
    this.chunks = []
    if (isWebm) blob = await fixWebmDuration(blob, durationMs, { logger: false })
    return { blob, durationMs, mimeType }
  }

  /** Stops and throws everything away. */
  async discard() {
    this.rec.ondataavailable = null
    if (this.rec.state !== 'inactive') this.rec.stop()
    this.chunks = []
    if (this.writable) {
      await this.writeQueue.catch(() => {})
      await this.writable.abort().catch(() => {})
      this.writable = null
    }
  }
}
