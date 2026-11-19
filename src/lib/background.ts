// Camera background effects: blur the room behind you, or swap it for a picture.
// Runs on this device with MediaPipe person segmentation; no frame ever leaves the browser.
import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { liveFrames, makeVideo, picture, TICKER, type LiveFrames } from './compositor'
import type { BackgroundBlur, CameraBackground } from './settings'

// MediaPipe's engine, copied into public/mediapipe by scripts/copy-wasm.mjs.
const wasmLoaderPath = '/mediapipe/vision_wasm_internal.js'
const wasmBinaryPath = '/mediapipe/vision_wasm_internal.wasm'

// Google's selfie segmentation model (~250 KB). Fetched once, then served from the browser cache.
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

const BLUR_PX: Record<BackgroundBlur, number> = { light: 8, medium: 16, strong: 28 }
/** How much of the new mask is used each frame; the rest comes from the last one. Stops edge flicker. */
const MASK_SMOOTHING = 0.65
const FPS = 30

let segmenterPromise: Promise<ImageSegmenter> | null = null

function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    // Loaded on first use, so the app starts just as fast for people who never turn it on.
    const create = async (delegate: 'GPU' | 'CPU') => {
      const { ImageSegmenter } = await import('@mediapipe/tasks-vision')
      return ImageSegmenter.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        },
      )
    }
    segmenterPromise = create('GPU').catch(() => create('CPU'))
    // Let a later attempt retry after a network failure.
    segmenterPromise.catch(() => (segmenterPromise = null))
  }
  return segmenterPromise
}

export interface PresetBackground {
  id: string
  name: string
  stops: string[]
}

/** Built-in backgrounds, drawn as gradients so they need no image files. */
export const PRESET_BACKGROUNDS: PresetBackground[] = [
  { id: 'preset:sky', name: 'Sky', stops: ['#dbeafe', '#93c5fd', '#3b82f6'] },
  { id: 'preset:peach', name: 'Peach', stops: ['#fff1eb', '#ffc3a0', '#ff8a80'] },
  { id: 'preset:mint', name: 'Mint', stops: ['#ecfdf5', '#a7f3d0', '#34d399'] },
  { id: 'preset:lavender', name: 'Lavender', stops: ['#f5f3ff', '#c4b5fd', '#8b5cf6'] },
  { id: 'preset:night', name: 'Night', stops: ['#1e293b', '#0f172a', '#020617'] },
  { id: 'preset:studio', name: 'Studio grey', stops: ['#f4f4f5', '#d4d4d8', '#a1a1aa'] },
]

/** Paints a preset onto a canvas, for the recording and for thumbnails. */
export function drawPreset(ctx: CanvasRenderingContext2D, preset: PresetBackground, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  preset.stops.forEach((c, i) => g.addColorStop(i / (preset.stops.length - 1), c))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // A soft light in the upper corner gives the flat gradient some depth.
  const glow = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.7)
  glow.addColorStop(0, 'rgba(255,255,255,0.35)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
}

const canvasFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

/**
 * Takes a camera stream and gives back a new stream with the background blurred or replaced.
 * Settings can change at any time without making a new stream.
 */
export class BackgroundProcessor {
  readonly stream: MediaStream
  mode: CameraBackground = 'blur'
  blur: BackgroundBlur = 'medium'
  /** The downstream preview and recording flip the camera; pre-flip pictures so their text reads correctly. */
  mirror = false
  /** Called once if the person model can't be loaded (usually: offline on first use). */
  onError: ((e: unknown) => void) | null = null

  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private person = document.createElement('canvas')
  private personCtx: CanvasRenderingContext2D
  private small = document.createElement('canvas')
  private mask = document.createElement('canvas')
  private maskData: ImageData | null = null
  private prevMask: Float32Array | null = null
  private image: CanvasImageSource | null = null
  private imageSize = { w: 0, h: 0 }
  private preset: PresetBackground | null = null
  private video: HTMLVideoElement
  private live: LiveFrames | null
  private segmenter: ImageSegmenter | null = null
  private worker: Worker
  private workerUrl: string
  private lastTs = -1

  constructor(source: MediaStream) {
    this.ctx = this.canvas.getContext('2d', { alpha: false })!
    this.personCtx = this.person.getContext('2d')!
    this.video = makeVideo(source)
    this.live = liveFrames(source)
    this.stream = this.canvas.captureStream(FPS)
    loadSegmenter().then(
      (s) => (this.segmenter = s),
      (e) => this.onError?.(e),
    )
    // Worker-driven like the compositor, so it keeps running while the window is hidden.
    this.workerUrl = URL.createObjectURL(new Blob([TICKER], { type: 'application/javascript' }))
    this.worker = new Worker(this.workerUrl)
    this.worker.onmessage = () => this.draw()
    this.worker.postMessage(Math.round(1000 / FPS))
  }

  /** Uses a picture (uploaded image) as the background. */
  setImage(img: CanvasImageSource | null, w = 0, h = 0) {
    if (this.image !== img) this.releaseImage()
    this.image = img
    this.imageSize = { w, h }
    if (img) this.preset = null
  }

  setPreset(p: PresetBackground | null) {
    this.preset = p
    if (p) {
      this.releaseImage()
      this.image = null
    }
  }

  private releaseImage() {
    if (this.image instanceof ImageBitmap) this.image.close()
  }

  destroy() {
    this.worker.terminate()
    URL.revokeObjectURL(this.workerUrl)
    this.releaseImage()
    this.image = null
    this.live?.stop()
    this.video.pause()
    this.video.srcObject = null
    this.stream.getTracks().forEach((t) => t.stop())
  }

  private draw() {
    const frame = picture(this.video, this.live)
    if (!frame) return
    const { w, h } = frame
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = this.person.width = w
      this.canvas.height = this.person.height = h
    }
    const ctx = this.ctx
    const mask = this.segment(frame.img)
    if (!mask || this.mode === 'none') {
      // Model still loading (or effect off): pass the camera through unchanged.
      ctx.drawImage(frame.img, 0, 0, w, h)
      return
    }

    this.drawBackground(frame.img, w, h)

    // Cut the person out: the soft-edged mask, then the camera picture kept only where the mask is.
    const p = this.personCtx
    p.globalCompositeOperation = 'copy'
    p.imageSmoothingQuality = 'high'
    if (canvasFilter) p.filter = `blur(${Math.max(1, Math.round(h / 360))}px)`
    p.drawImage(mask, 0, 0, w, h)
    if (canvasFilter) p.filter = 'none'
    p.globalCompositeOperation = 'source-in'
    p.drawImage(frame.img, 0, 0, w, h)
    p.globalCompositeOperation = 'source-over'
    ctx.drawImage(this.person, 0, 0)
  }

  private drawBackground(img: CanvasImageSource, w: number, h: number) {
    const ctx = this.ctx
    if (this.mode === 'image' && (this.image || this.preset)) {
      ctx.save()
      if (this.mirror) {
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
      }
      if (this.image) {
        // Cover-fit: fill the frame, crop the overflow.
        const s = Math.max(w / this.imageSize.w, h / this.imageSize.h)
        const iw = this.imageSize.w * s
        const ih = this.imageSize.h * s
        ctx.drawImage(this.image, (w - iw) / 2, (h - ih) / 2, iw, ih)
      } else {
        drawPreset(ctx, this.preset!, w, h)
      }
      ctx.restore()
      return
    }
    // Blur: shrink first (cheaper, and smoother), blur, then scale back up a bit past the edges
    // so the blur never pulls dark borders into the frame.
    const px = BLUR_PX[this.blur]
    const k = 4
    const sw = Math.max(2, Math.round(w / k))
    const sh = Math.max(2, Math.round(h / k))
    const small = this.small
    if (small.width !== sw || small.height !== sh) {
      small.width = sw
      small.height = sh
    }
    const sc = small.getContext('2d')!
    if (canvasFilter) {
      sc.drawImage(img, 0, 0, sw, sh)
      ctx.filter = `blur(${px}px)`
      const pad = px * 2
      ctx.drawImage(small, -pad, -pad, w + pad * 2, h + pad * 2)
      ctx.filter = 'none'
    } else {
      // No canvas filter (older Safari): a much smaller copy scaled up reads as a blur.
      const f = Math.max(2, Math.round(px / 2))
      const tw = Math.max(2, Math.round(sw / f))
      const th = Math.max(2, Math.round(sh / f))
      sc.drawImage(img, 0, 0, tw, th)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, tw, th, 0, 0, w, h)
    }
  }

  /** Runs the person model on the frame and returns a mask canvas (alpha = person), or null if not ready. */
  private segment(img: CanvasImageSource): HTMLCanvasElement | null {
    const seg = this.segmenter
    if (!seg || this.mode === 'none') return null
    // VIDEO mode needs strictly increasing timestamps.
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
    this.lastTs = ts
    try {
      const result = seg.segmentForVideo(img as TexImageSource, ts)
      const m = result.confidenceMasks?.[0]
      if (m) {
        const conf = m.getAsFloat32Array()
        this.writeMask(conf, m.width, m.height)
      }
      result.close()
    } catch {
      // A frame that can't be read (e.g. while a camera switches) keeps the last mask.
    }
    return this.maskData ? this.mask : null
  }

  private writeMask(conf: Float32Array, mw: number, mh: number) {
    if (!this.maskData || this.maskData.width !== mw || this.maskData.height !== mh) {
      this.mask.width = mw
      this.mask.height = mh
      this.maskData = new ImageData(mw, mh)
      this.prevMask = null
    }
    const prev = this.prevMask
    const next = prev ?? new Float32Array(conf.length)
    const data = this.maskData.data
    for (let i = 0; i < conf.length; i++) {
      const v = prev ? prev[i] + (conf[i] - prev[i]) * MASK_SMOOTHING : conf[i]
      next[i] = v
      // Sharpen the soft confidence into a cleaner edge: below 0.3 is background, above 0.7 is person.
      const a = Math.min(1, Math.max(0, (v - 0.3) / 0.4))
      const j = i * 4
      data[j] = data[j + 1] = data[j + 2] = 255
      data[j + 3] = a * 255
    }
    this.prevMask = next
    this.mask.getContext('2d')!.putImageData(this.maskData, 0, 0)
  }
}
