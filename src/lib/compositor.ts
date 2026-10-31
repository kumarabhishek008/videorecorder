import type { BubbleShape } from './settings'

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

  private draw() {
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = '#0b0b0d'
    ctx.fillRect(0, 0, W, H)

    const screen = this.screen
    if (screen && screen.videoWidth) {
      // Contain-fit so window resizes or surface switches never distort the capture.
      const s = Math.min(W / screen.videoWidth, H / screen.videoHeight)
      const w = screen.videoWidth * s
      const h = screen.videoHeight * s
      ctx.drawImage(screen, (W - w) / 2, (H - h) / 2, w, h)
      if (this.camera && this.cameraVisible && this.drawBubble) this.drawCameraBubble()
    } else if (!screen && this.camera) {
      if (this.cameraVisible) this.drawCameraFull()
      else this.drawPlaceholder('Camera off')
    }
    this.drawStrokes()
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
