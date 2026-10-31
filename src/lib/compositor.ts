import type { BubbleShape, ClickEffect } from './settings'

export interface BubbleLayout {
  /** Center of the bubble as a fraction of canvas width / height. */
  x: number
  y: number
  /** Diameter as a fraction of canvas height. */
  size: number
}

export interface Stroke {
  color: string
  points: { x: number; y: number }[]
  endedAt: number | null
}

export const BUBBLE_SIZES = [0.22, 0.34, 0.5]
const STROKE_HOLD_MS = 2500
const STROKE_FADE_MS = 800
/** How long a click zoom / spotlight stays before easing back out. */
const EFFECT_HOLD_MS = 3500
const RIPPLE_MS = 700

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// A worker-driven ticker keeps drawing at full rate while the tab is hidden
// (requestAnimationFrame and main-thread timers are throttled in background tabs).
const TICKER = `let id=null;onmessage=e=>{if(id)clearInterval(id);id=e.data>0?setInterval(()=>postMessage(0),e.data):null}`

function makeVideo(stream: MediaStream): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.autoplay = true
  v.srcObject = stream
  void v.play().catch(() => {})
  return v
}

export function clampLayout(l: BubbleLayout, aspect: number): BubbleLayout {
  const size = Math.min(0.95, Math.max(0.1, l.size))
  const rx = size / 2 / aspect
  const ry = size / 2
  return {
    size,
    x: Math.min(1 - rx, Math.max(rx, l.x)),
    y: Math.min(1 - ry, Math.max(ry, l.y)),
  }
}

export function bubblePath(ctx: CanvasRenderingContext2D, shape: BubbleShape, x: number, y: number, d: number) {
  ctx.beginPath()
  if (shape === 'circle') ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
  else ctx.roundRect(x, y, d, d, shape === 'rounded' ? d * 0.18 : d * 0.03)
}

export class Compositor {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private screen: HTMLVideoElement | null = null
  private camera: HTMLVideoElement | null = null
  private worker: Worker | null = null
  private workerUrl: string | null = null

  layout: BubbleLayout = { x: 0.88, y: 0.8, size: BUBBLE_SIZES[0] }
  shape: BubbleShape = 'circle'
  mirror = true
  cameraVisible = true
  /** When false the camera is shown in a floating window instead of being drawn into the video. */
  drawBubble = true
  strokes: Stroke[] = []
  clickEffect: ClickEffect = 'zoom'
  zoomLevel = 2

  private zoom = { x: 0.5, y: 0.5, s: 1 }
  private zoomTarget = { x: 0.5, y: 0.5, s: 1 }
  private zoomUntil = 0
  private spot = { x: 0.5, y: 0.5, alpha: 0, until: 0 }
  private ripples: { x: number; y: number; t: number }[] = []
  private lastFrame = 0

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true })!
  }

  get width() {
    return this.canvas.width
  }
  get height() {
    return this.canvas.height
  }
  get aspect() {
    return this.canvas.width / this.canvas.height
  }

  setScreen(stream: MediaStream | null) {
    this.screen?.pause()
    this.screen = stream ? makeVideo(stream) : null
  }

  setCamera(stream: MediaStream | null) {
    this.camera?.pause()
    this.camera = stream ? makeVideo(stream) : null
  }

  start(fps: number) {
    this.stop()
    this.workerUrl = URL.createObjectURL(new Blob([TICKER], { type: 'application/javascript' }))
    this.worker = new Worker(this.workerUrl)
    this.worker.onmessage = () => this.draw()
    this.worker.postMessage(Math.round(1000 / fps))
    this.draw()
  }

  stop() {
    this.worker?.terminate()
    this.worker = null
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl)
    this.workerUrl = null
  }

  captureStream(fps: number): MediaStream {
    return this.canvas.captureStream(fps)
  }

  destroy() {
    this.stop()
    this.setScreen(null)
    this.setCamera(null)
  }

  /** Reacts to a click at a point of the displayed frame (0..1): ripple, plus zoom or spotlight. */
  click(nx: number, ny: number) {
    if (this.clickEffect === 'off') return
    const p = this.toSource(nx, ny)
    const now = performance.now()
    this.ripples.push({ ...p, t: now })
    if (this.clickEffect === 'zoom') {
      this.zoomTarget = { x: p.x, y: p.y, s: this.zoomLevel }
      this.zoomUntil = now + EFFECT_HOLD_MS
    } else if (this.clickEffect === 'spotlight') {
      this.spot.x = p.x
      this.spot.y = p.y
      this.spot.until = now + EFFECT_HOLD_MS
    }
  }

  resetEffects() {
    this.zoomUntil = 0
    this.spot.until = 0
  }

  /** The part of the frame currently shown, as origin + scale. */
  private view() {
    const s = this.zoom.s
    const max = 1 - 1 / s
    return { s, x0: clamp(this.zoom.x - 0.5 / s, 0, max), y0: clamp(this.zoom.y - 0.5 / s, 0, max) }
  }

  private toSource(nx: number, ny: number) {
    const v = this.view()
    return { x: v.x0 + nx / v.s, y: v.y0 + ny / v.s }
  }

  private toView(p: { x: number; y: number }) {
    const v = this.view()
    return { x: (p.x - v.x0) * v.s * this.width, y: (p.y - v.y0) * v.s * this.height }
  }

  private updateEffects(now: number) {
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16
    this.lastFrame = now
    if (now > this.zoomUntil) this.zoomTarget.s = 1
    const k = 1 - Math.exp(-dt / 160)
    this.zoom.s += (this.zoomTarget.s - this.zoom.s) * k
    this.zoom.x += (this.zoomTarget.x - this.zoom.x) * k
    this.zoom.y += (this.zoomTarget.y - this.zoom.y) * k
    if (this.zoomTarget.s === 1 && this.zoom.s < 1.002) this.zoom.s = 1
    this.spot.alpha += ((now < this.spot.until ? 1 : 0) - this.spot.alpha) * k
    this.ripples = this.ripples.filter((r) => now - r.t < RIPPLE_MS)
  }

  private draw() {
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    const now = performance.now()
    this.updateEffects(now)
    ctx.fillStyle = '#0b0b0d'
    ctx.fillRect(0, 0, W, H)

    const { s, x0, y0 } = this.view()
    ctx.save()
    ctx.scale(s, s)
    ctx.translate(-x0 * W, -y0 * H)
    const screen = this.screen
    if (screen && screen.videoWidth) {
      // Contain-fit so window resizes or surface switches never distort the capture.
      const f = Math.min(W / screen.videoWidth, H / screen.videoHeight)
      const w = screen.videoWidth * f
      const h = screen.videoHeight * f
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(screen, (W - w) / 2, (H - h) / 2, w, h)
    } else if (!screen && this.camera) {
      if (this.cameraVisible) this.drawCameraFull()
      else this.drawPlaceholder('Camera off')
    }
    ctx.restore()

    this.drawSpotlight()
    this.drawRipples(now)
    if (screen?.videoWidth && this.camera && this.cameraVisible && this.drawBubble) this.drawCameraBubble()
    this.drawStrokes()
  }

  private drawSpotlight() {
    if (this.spot.alpha < 0.01) return
    const { ctx } = this
    const c = this.toView(this.spot)
    const r = this.height * 0.15 * this.zoom.s
    ctx.save()
    ctx.globalAlpha = this.spot.alpha
    ctx.fillStyle = 'rgba(2, 8, 23, 0.6)'
    ctx.beginPath()
    ctx.rect(0, 0, this.width, this.height)
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.fill('evenodd')
    ctx.lineWidth = Math.max(2, this.height / 300)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)'
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private drawRipples(now: number) {
    const { ctx } = this
    for (const r of this.ripples) {
      const t = (now - r.t) / RIPPLE_MS
      const c = this.toView(r)
      const base = this.height * 0.025
      ctx.save()
      ctx.globalAlpha = 1 - t
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)'
      ctx.beginPath()
      ctx.arc(c.x, c.y, base * (1 + t), 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = Math.max(2, this.height / 250)
      ctx.strokeStyle = '#38bdf8'
      ctx.beginPath()
      ctx.arc(c.x, c.y, base * (1 + t * 2.5), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawCameraFull() {
    const cam = this.camera!
    if (!cam.videoWidth) return
    const { ctx } = this
    const W = this.width
    const H = this.height
    const s = Math.max(W / cam.videoWidth, H / cam.videoHeight)
    const w = cam.videoWidth * s
    const h = cam.videoHeight * s
    ctx.save()
    if (this.mirror) {
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(cam, (W - w) / 2, (H - h) / 2, w, h)
    ctx.restore()
  }

  private drawCameraBubble() {
    const cam = this.camera!
    if (!cam.videoWidth) return
    const { ctx } = this
    const l = clampLayout(this.layout, this.aspect)
    const d = l.size * this.height
    const x = l.x * this.width - d / 2
    const y = l.y * this.height - d / 2

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = d * 0.08
    ctx.shadowOffsetY = d * 0.02
    bubblePath(ctx, this.shape, x, y, d)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()

    ctx.save()
    bubblePath(ctx, this.shape, x, y, d)
    ctx.clip()
    const side = Math.min(cam.videoWidth, cam.videoHeight)
    const sx = (cam.videoWidth - side) / 2
    const sy = (cam.videoHeight - side) / 2
    if (this.mirror) {
      ctx.translate(x + d, y)
      ctx.scale(-1, 1)
      ctx.drawImage(cam, sx, sy, side, side, 0, 0, d, d)
    } else {
      ctx.drawImage(cam, sx, sy, side, side, x, y, d, d)
    }
    ctx.restore()

    ctx.save()
    bubblePath(ctx, this.shape, x, y, d)
    ctx.lineWidth = Math.max(2, d * 0.012)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.stroke()
    ctx.restore()
  }

  private drawPlaceholder(text: string) {
    const { ctx } = this
    ctx.fillStyle = '#a1a1aa'
    ctx.font = `${Math.round(this.height / 20)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, this.width / 2, this.height / 2)
  }

  private drawStrokes() {
    if (this.strokes.length === 0) return
    const now = performance.now()
    const { ctx } = this
    this.strokes = this.strokes.filter((s) => s.endedAt === null || now - s.endedAt < STROKE_HOLD_MS + STROKE_FADE_MS)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(3, this.height / 160)
    for (const s of this.strokes) {
      if (s.points.length < 2) continue
      const age = s.endedAt === null ? 0 : now - s.endedAt
      ctx.globalAlpha = age < STROKE_HOLD_MS ? 1 : Math.max(0, 1 - (age - STROKE_HOLD_MS) / STROKE_FADE_MS)
      ctx.strokeStyle = s.color
      ctx.beginPath()
      ctx.moveTo(s.points[0].x * this.width, s.points[0].y * this.height)
      for (const p of s.points.slice(1)) ctx.lineTo(p.x * this.width, p.y * this.height)
      ctx.stroke()
    }
    ctx.restore()
  }
}

const RES_HEIGHT: Record<string, number> = { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160 }

/** Output canvas size: the capture's aspect ratio, capped to the chosen height, with even dimensions. */
export function outputSize(srcW: number, srcH: number, resolution: string): { width: number; height: number } {
  const maxH = RES_HEIGHT[resolution]
  let w = srcW
  let h = srcH
  if (maxH && h > maxH) {
    w = (w * maxH) / h
    h = maxH
  }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { width: even(w), height: even(h) }
}

export function waitForVideoSize(stream: MediaStream): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const v = makeVideo(stream)
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      const size = { width: v.videoWidth || 1920, height: v.videoHeight || 1080 }
      v.pause()
      v.srcObject = null
      resolve(size)
    }
    if (v.videoWidth) return done()
    v.addEventListener('loadedmetadata', done, { once: true })
    setTimeout(done, 3000)
  })
}
