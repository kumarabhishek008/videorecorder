// Plays and renders an editor project onto a canvas, and exports it to a video file.
// Each clip gets its own media element so splits, overlaps and transitions can play together.
import fixWebmDuration from 'fix-webm-duration'
import { closeContext } from '../lib/audio'
import { TICKER } from '../lib/compositor'
import { CleanPlate, iou, lerpBox, removeObjects, type Box } from '../lib/objects'
import { pickMimeType } from '../lib/recorder'
import type { Format } from '../lib/settings'
import { Grader, isNeutral } from './grade'
import { getLut } from './luts'
import { drawText } from './text'
import { drawTransition } from './transitions'
import { clipEnd, isMedia, isText, projectDuration, type Asset, type ClipObjects, type MediaClip, type Project } from './types'

/** Seconds of drift allowed before a playing clip is re-synced to the timeline. */
const MAX_DRIFT = 0.25
const PRELOAD = 1.5

interface ClipMedia {
  el: HTMLVideoElement | HTMLAudioElement | HTMLImageElement
  assetId: string
  gain: GainNode | null
  source: MediaElementAudioSourceNode | null
}

const isAV = (el: ClipMedia['el']): el is HTMLVideoElement | HTMLAudioElement => !(el instanceof HTMLImageElement)

/** Object boxes to remove at source time `t`, interpolated between scan samples. */
export function boxesAt(objects: ClipObjects, t: number): Box[] {
  if (!objects.remove.length || !objects.samples.length) return []
  const remove = new Set(objects.remove)
  const s = objects.samples
  let i = s.findIndex((x) => x.t > t)
  if (i === -1) i = s.length
  const a = s[i - 1]
  const b = s[i]
  const out: Box[] = []
  if (a) {
    const k = b ? (t - a.t) / (b.t - a.t || 1) : 0
    for (const o of a.objs) {
      if (!remove.has(o.label)) continue
      const match = b?.objs.filter((x) => x.label === o.label).sort((x, y) => iou(y.box, o.box) - iou(x.box, o.box))[0]
      if (match && iou(match.box, o.box) > 0.05) out.push(lerpBox(o.box, match.box, k))
      else if (!b || t - a.t < 0.6) out.push(o.box)
    }
  }
  // Objects about to appear in the next sample are covered a little early.
  if (b && b.t - t < 0.4) for (const o of b.objs) if (remove.has(o.label) && !out.some((x) => iou(x, o.box) > 0.2)) out.push(o.box)
  return out
}

export class EditorEngine {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private project: Project | null = null
  private urls = new Map<string, string>()
  private media = new Map<string, ClipMedia>()
  private grader = new Grader()
  private work = document.createElement('canvas')
  private workCtx = this.work.getContext('2d')!
  /** Clean background learned per clip, for object removal. */
  readonly plates = new Map<string, CleanPlate>()
  private audio: AudioContext | null = null
  private master: GainNode | null = null
  private exportDest: MediaStreamAudioDestinationNode | null = null
  private worker: Worker | null = null
  private workerUrl: string | null = null
  private clockStart = 0
  private timeAtStart = 0
  private seekToken = 0
  time = 0
  playing = false
  onTime: ((t: number) => void) | null = null
  onEnded: (() => void) | null = null

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
  }

  get duration() {
    return this.project ? projectDuration(this.project) : 0
  }

  setProject(p: Project, urls: Map<string, string>) {
    this.project = p
    this.urls = urls
    if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
      this.canvas.width = p.width
      this.canvas.height = p.height
    }
    // Drop media for clips that are gone or now point at another asset.
    for (const [id, m] of this.media) {
      const c = p.clips.find((x) => x.id === id)
      if (!c || !isMedia(c) || c.assetId !== m.assetId) this.disposeMedia(id)
    }
    if (!this.playing) void this.seek(this.time)
  }

  private asset(id: string): Asset | undefined {
    return this.project?.assets.find((a) => a.id === id)
  }

  private ensureMedia(c: MediaClip): ClipMedia | null {
    const existing = this.media.get(c.id)
    if (existing) return existing
    const asset = this.asset(c.assetId)
    const url = this.urls.get(c.assetId)
    if (!asset || !url) return null
    let el: ClipMedia['el']
    if (asset.kind === 'image') {
      el = new Image()
      el.src = url
    } else {
      el = document.createElement(asset.kind === 'video' ? 'video' : 'audio')
      el.preload = 'auto'
      el.src = url
      if (el instanceof HTMLVideoElement) el.playsInline = true
      el.muted = !this.audio
    }
    const m: ClipMedia = { el, assetId: c.assetId, gain: null, source: null }
    this.media.set(c.id, m)
    this.connectAudio(m)
    return m
  }

  private connectAudio(m: ClipMedia) {
    if (!this.audio || !this.master || m.source || !isAV(m.el)) return
    try {
      m.source = this.audio.createMediaElementSource(m.el)
      m.gain = this.audio.createGain()
      m.source.connect(m.gain).connect(this.master)
      m.el.muted = false
    } catch {
      // Already connected elsewhere; it plays through the element instead.
    }
  }

  private disposeMedia(id: string) {
    const m = this.media.get(id)
    if (!m) return
    if (isAV(m.el)) {
      m.el.pause()
      m.el.removeAttribute('src')
      m.el.load()
    }
    m.source?.disconnect()
    m.gain?.disconnect()
    this.media.delete(id)
  }

  /** Sets up sound; must be called from a click the first time (browsers block audio before that). */
  ensureAudio() {
    if (this.audio) return
    this.audio = new AudioContext()
    this.master = this.audio.createGain()
    this.master.connect(this.audio.destination)
    for (const m of this.media.values()) this.connectAudio(m)
  }

  play() {
    if (!this.project || this.playing) return
    this.ensureAudio()
    void this.audio?.resume()
    if (this.time >= this.duration - 0.05) this.time = 0
    this.playing = true
    this.clockStart = performance.now()
    this.timeAtStart = this.time
    this.startTicker()
  }

  pause() {
    this.playing = false
    this.stopTicker()
    for (const m of this.media.values()) if (isAV(m.el)) m.el.pause()
  }

  private startTicker() {
    this.stopTicker()
    const fps = this.project?.fps ?? 30
    this.workerUrl = URL.createObjectURL(new Blob([TICKER], { type: 'application/javascript' }))
    this.worker = new Worker(this.workerUrl)
    this.worker.onmessage = () => this.tick()
    this.worker.postMessage(Math.round(1000 / fps))
  }

  private stopTicker() {
    this.worker?.terminate()
    this.worker = null
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl)
    this.workerUrl = null
  }

  private tick() {
    if (!this.playing) return
    const t = this.timeAtStart + (performance.now() - this.clockStart) / 1000
    if (t >= this.duration) {
      this.time = this.duration
      this.render()
      this.pause()
      this.onTime?.(this.time)
      this.onEnded?.()
      return
    }
    this.time = t
    this.syncMedia(t)
    this.render()
    this.onTime?.(t)
  }

  /** Starts, stops and re-syncs each clip's media to the timeline. */
  private syncMedia(t: number) {
    const p = this.project!
    for (const c of p.clips) {
      if (!isMedia(c)) continue
      const track = p.tracks.find((x) => x.id === c.trackId)
      const inRange = t >= c.start && t < clipEnd(c)
      const near = t >= c.start - PRELOAD && t < clipEnd(c) + 0.5
      if (!near && !this.isTransitionSource(c, t)) {
        const m = this.media.get(c.id)
        if (m && isAV(m.el) && !m.el.paused) m.el.pause()
        continue
      }
      const m = this.ensureMedia(c)
      if (!m || !isAV(m.el)) continue
      const el = m.el
      if (m.gain) m.gain.gain.value = this.clipGain(c, t, !!track?.muted)
      else el.volume = Math.min(1, this.clipGain(c, t, !!track?.muted))
      if (inRange) {
        const want = c.in + (t - c.start)
        if (el.paused) {
          el.currentTime = want
          void el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - want) > MAX_DRIFT) {
          el.currentTime = want
        }
      } else {
        if (!el.paused) el.pause()
        // Park just before the clip starts so it begins on its first frame.
        if (t < c.start && Math.abs(el.currentTime - c.in) > 0.1) el.currentTime = c.in
      }
    }
  }

  private clipGain(c: MediaClip, t: number, trackMuted: boolean) {
    if (c.muted || trackMuted) return 0
    const local = t - c.start
    let g = c.volume
    if (c.fadeIn > 0 && local < c.fadeIn) g *= Math.max(0, local / c.fadeIn)
    if (c.fadeOut > 0 && c.duration - local < c.fadeOut) g *= Math.max(0, (c.duration - local) / c.fadeOut)
    return g
  }

  /** The clip that the next clip on its track transitions from, if `t` is in that transition. */
  private transitionFrom(c: MediaClip, t: number): MediaClip | null {
    const tr = c.transitionIn
    if (tr.type === 'none' || t >= c.start + tr.duration || t < c.start) return null
    const prev = this.project!.clips.find((x) => isMedia(x) && x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < 0.05)
    return (prev as MediaClip) ?? null
  }

  private touchingBefore(c: MediaClip) {
    return this.project!.clips.some((x) => isMedia(x) && x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < 0.05)
  }

  private isTransitionSource(c: MediaClip, t: number) {
    return this.project!.clips.some((n) => isMedia(n) && n.trackId === c.trackId && n.transitionIn.type !== 'none' && Math.abs(c.start + c.duration - n.start) < 0.05 && t >= n.start && t < n.start + n.transitionIn.duration)
  }

  /** Jumps to `t` and draws that frame once every visible clip has seeked. */
  async seek(t: number) {
    const p = this.project
    if (!p) return
    this.time = Math.max(0, Math.min(t, this.duration))
    if (this.playing) {
      this.clockStart = performance.now()
      this.timeAtStart = this.time
      this.syncMedia(this.time)
      return
    }
    const token = ++this.seekToken
    const waits: Promise<unknown>[] = []
    for (const c of p.clips) {
      if (!isMedia(c)) continue
      const active = this.time >= c.start && this.time < clipEnd(c)
      const fromTransition = this.isTransitionSource(c, this.time)
      if (!active && !fromTransition) continue
      const m = this.ensureMedia(c)
      if (!m) continue
      const el = m.el
      if (!isAV(el)) {
        if (!el.complete) waits.push(new Promise((r) => el.addEventListener('load', r, { once: true })))
        continue
      }
      el.pause()
      const want = active ? c.in + (this.time - c.start) : c.in + c.duration - 0.04
      if (Math.abs(el.currentTime - want) > 0.01 || el.readyState < 2) {
        waits.push(
          new Promise((r) => {
            const done = () => r(null)
            el.addEventListener('seeked', done, { once: true })
            el.addEventListener('loadeddata', done, { once: true })
            setTimeout(done, 1500)
          }),
        )
        el.currentTime = want
      }
    }
    if (waits.length) await Promise.all(waits)
    if (token === this.seekToken) this.render()
  }

  /** Draws the frame at the current time. */
  render() {
    const p = this.project
    if (!p) return
    const { ctx } = this
    const W = p.width
    const H = p.height
    const t = this.time
    ctx.save()
    ctx.fillStyle = p.background
    ctx.fillRect(0, 0, W, H)
    // Tracks are listed top-first; the bottom track is drawn first.
    for (const track of [...p.tracks].reverse()) {
      if (track.kind === 'audio' || track.hidden) continue
      for (const c of p.clips) {
        if (c.trackId !== track.id || t < c.start || t >= clipEnd(c)) continue
        if (isText(c)) drawText(ctx, c, t - c.start, W, H)
        else if (isMedia(c)) {
          const src = c.in + (t - c.start)
          const tin = c.transitionIn
          const tout = c.transitionOut
          const outStart = tout ? clipEnd(c) - Math.min(tout.duration, c.duration) : Infinity
          const from = this.transitionFrom(c, t)
          if (from) {
            drawTransition(ctx, tin.type, (t - c.start) / tin.duration, W, H, (x) => this.drawClip(x, from, from.in + from.duration - 0.04), (x) => this.drawClip(x, c, src))
          } else if (tin.type !== 'none' && t < c.start + tin.duration && !this.touchingBefore(c)) {
            // Nothing right before it: enter from an empty frame (what's underneath shows through).
            drawTransition(ctx, tin.type, (t - c.start) / tin.duration, W, H, () => {}, (x) => this.drawClip(x, c, src))
          } else if (tout && tout.type !== 'none' && t >= outStart) {
            // Leave at the end of the clip, into an empty frame.
            drawTransition(ctx, tout.type, (t - outStart) / Math.max(0.05, clipEnd(c) - outStart), W, H, (x) => this.drawClip(x, c, src), () => {})
          } else this.drawClip(ctx, c, src)
        }
      }
    }
    ctx.restore()
  }

  private drawClip(ctx: CanvasRenderingContext2D, c: MediaClip, sourceT: number) {
    const asset = this.asset(c.assetId)
    const m = this.ensureMedia(c)
    if (!asset || !m || asset.kind === 'audio') return
    const el = m.el as HTMLVideoElement | HTMLImageElement
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
    if (!sw || !sh || (el instanceof HTMLVideoElement && el.readyState < 2)) return
    const W = this.project!.width
    const H = this.project!.height
    const f = c.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)
    const dw = sw * f * c.scale
    const dh = sh * f * c.scale
    const dx = c.x * W - dw / 2
    const dy = c.y * H - dh / 2

    // Render at the size it's shown (never above the source) to keep grading cheap.
    const rw = Math.max(2, Math.round(Math.min(dw, sw)))
    const rh = Math.max(2, Math.round(Math.min(dh, sh)))
    let img: CanvasImageSource = el
    const lut = getLut(c.lut)
    if ((!isNeutral(c.color) || (lut && c.lutStrength > 0)) && this.grader.render(el, rw, rh, c.color, lut, c.lutStrength)) img = this.grader.canvas

    const boxes = c.objects ? boxesAt(c.objects, sourceT) : []
    if (c.objects?.samples.length) {
      // Keep learning the empty scene while the clip plays.
      let plate = this.plates.get(c.id)
      if (!plate) this.plates.set(c.id, (plate = new CleanPlate()))
      const all = c.objects.samples.reduce<Box[]>((acc, s) => (Math.abs(s.t - sourceT) < 0.5 ? acc.concat(s.objs.map((o) => o.box)) : acc), [])
      if (this.playing) plate.update(el, sw, sh, all, 0.15)
    }
    if (boxes.length) {
      if (this.work.width !== rw || this.work.height !== rh) {
        this.work.width = rw
        this.work.height = rh
      }
      this.workCtx.clearRect(0, 0, rw, rh)
      this.workCtx.drawImage(img, 0, 0, rw, rh)
      removeObjects(this.workCtx, this.work, rw, rh, boxes, this.plates.get(c.id) ?? null)
      img = this.work
    }
    ctx.save()
    ctx.globalAlpha = c.opacity
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.restore()
  }

  destroy() {
    this.pause()
    for (const id of [...this.media.keys()]) this.disposeMedia(id)
    if (this.audio) closeContext(this.audio)
    this.audio = null
  }

  /**
   * Exports the project by playing it in real time into a MediaRecorder.
   * Use a separate engine instance so the on-screen preview stays free.
   */
  export(format: Format, onProgress: (f: number) => void): { promise: Promise<{ blob: Blob; durationMs: number; mimeType: string }>; cancel: () => void } {
    let cancelled = false
    let rec: MediaRecorder | null = null
    const promise = new Promise<{ blob: Blob; durationMs: number; mimeType: string }>((resolve, reject) => {
      const p = this.project
      if (!p || this.duration <= 0) return reject(new Error('The timeline is empty.'))
      this.ensureAudio()
      this.exportDest = this.audio!.createMediaStreamDestination()
      this.master!.disconnect()
      this.master!.connect(this.exportDest)
      const stream = new MediaStream([...this.canvas.captureStream(p.fps).getVideoTracks(), ...this.exportDest.stream.getAudioTracks()])
      const mimeType = pickMimeType(format, 'video')
      const chunks: Blob[] = []
      const pixels = p.width * p.height
      rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: Math.min(40_000_000, Math.round(pixels * p.fps * 0.12)), audioBitsPerSecond: 192_000 })
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (cancelled) return
        const type = (rec!.mimeType || mimeType).split(';')[0]
        const durationMs = this.duration * 1000
        let blob = new Blob(chunks, { type })
        if (type.includes('webm')) blob = await fixWebmDuration(blob, durationMs, { logger: false })
        resolve({ blob, durationMs, mimeType: rec!.mimeType || mimeType })
      }
      const total = this.duration
      this.onTime = (t) => onProgress(Math.min(1, t / total))
      this.onEnded = () => {
        // Let the last frames reach the recorder.
        setTimeout(() => rec?.state === 'recording' && rec.stop(), 250)
      }
      void (async () => {
        await this.audio!.resume()
        await this.seek(0)
        rec!.start(1000)
        this.play()
      })().catch((e) => reject(e))
    })
    return {
      promise,
      cancel: () => {
        cancelled = true
        this.pause()
        if (rec && rec.state !== 'inactive') rec.stop()
      },
    }
  }
}
