// Object detection (ml5.js, COCO-SSD) and object removal, shared by live recording and the editor.
// Everything runs in this browser; frames never leave the device.
import type { Ml5ObjectDetector } from 'ml5'
import { liveFrames, makeVideo, picture, TICKER, type LiveFrames } from './compositor'

/** A box in 0..1 coordinates of the frame. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Detection {
  label: string
  score: number
  box: Box
}

export interface TrackedObject extends Detection {
  id: number
  firstSeen: number
  lastSeen: number
}

/** The detector looks at a small copy of the frame: fast, and plenty for finding objects. */
const DETECT_WIDTH = 320
const MIN_SCORE = 0.45

let detectorPromise: Promise<Ml5ObjectDetector> | null = null

/** Loads ml5.js and its COCO-SSD model on first use (~5 MB, then cached by the browser). */
export function loadDetector(): Promise<Ml5ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const mod = await import('ml5')
      const ml5 = (mod as { default?: typeof mod.default }).default ?? (mod as unknown as typeof mod.default)
      const detector = ml5.objectDetection('cocossd')
      await detector.ready
      return detector
    })()
    detectorPromise.catch(() => (detectorPromise = null))
  }
  return detectorPromise
}

const scratch = document.createElement('canvas')

/** Runs the detector on any drawable frame and returns boxes in 0..1 coordinates. */
export async function detectObjects(detector: Ml5ObjectDetector, img: CanvasImageSource, w: number, h: number): Promise<Detection[]> {
  const dw = DETECT_WIDTH
  const dh = Math.max(1, Math.round((h / w) * dw))
  if (scratch.width !== dw || scratch.height !== dh) {
    scratch.width = dw
    scratch.height = dh
  }
  scratch.getContext('2d')!.drawImage(img, 0, 0, dw, dh)
  const found = await detector.detect(scratch)
  return found
    .filter((d) => d.confidence >= MIN_SCORE)
    .map((d) => ({
      label: d.label,
      score: d.confidence,
      box: { x: d.x / dw, y: d.y / dh, w: d.width / dw, h: d.height / dh },
    }))
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

export function lerpBox(a: Box, b: Box, t: number): Box {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t }
}

/** Gives detections stable ids across frames and smooths their boxes, so removal doesn't flicker. */
export class ObjectTracker {
  objects: TrackedObject[] = []
  private nextId = 1
  /** How long an object stays after it was last seen; covers frames where the detector misses it. */
  holdMs = 900

  update(dets: Detection[], now: number) {
    const used = new Set<TrackedObject>()
    for (const d of dets) {
      let best: TrackedObject | null = null
      let bestIou = 0.15
      for (const o of this.objects) {
        if (used.has(o) || o.label !== d.label) continue
        const v = iou(o.box, d.box)
        if (v > bestIou) {
          bestIou = v
          best = o
        }
      }
      if (best) {
        best.box = lerpBox(best.box, d.box, 0.7)
        best.score = d.score
        best.lastSeen = now
        used.add(best)
      } else {
        const o = { ...d, id: this.nextId++, firstSeen: now, lastSeen: now }
        this.objects.push(o)
        used.add(o)
      }
    }
    this.objects = this.objects.filter((o) => now - o.lastSeen < this.holdMs)
  }

  clear() {
    this.objects = []
  }
}

/** Grows a box around its center (and clamps it to the frame). */
export function padBox(b: Box, f: number): Box {
  const px = b.w * f
  const py = b.h * f
  const x = Math.max(0, b.x - px)
  const y = Math.max(0, b.y - py)
  return { x, y, w: Math.min(1, b.x + b.w + px) - x, h: Math.min(1, b.y + b.h + py) - y }
}

/**
 * A picture of the scene without its objects, learned over time: each frame updates it
 * everywhere except where objects (and people) are. Removing an object paints this back in.
 * Its alpha shows how much of each area has been seen clear so far.
 */
export class CleanPlate {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private temp = document.createElement('canvas')
  private tctx = this.temp.getContext('2d')!

  /** Plates are kept small: they're blurred into place anyway and this keeps updates cheap. */
  constructor(private maxSide = 640) {}

  reset() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  update(img: CanvasImageSource, w: number, h: number, exclude: Box[], rate = 0.25) {
    const s = Math.min(1, this.maxSide / Math.max(w, h))
    const pw = Math.max(2, Math.round(w * s))
    const ph = Math.max(2, Math.round(h * s))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = this.temp.width = pw
      this.canvas.height = this.temp.height = ph
    }
    this.tctx.globalCompositeOperation = 'copy'
    this.tctx.drawImage(img, 0, 0, pw, ph)
    this.tctx.globalCompositeOperation = 'source-over'
    for (const b of exclude) {
      const p = padBox(b, 0.15)
      this.tctx.clearRect(p.x * pw, p.y * ph, p.w * pw, p.h * ph)
    }
    // Blend in slowly so lighting changes are followed but one bad frame does little harm.
    this.ctx.globalAlpha = rate
    this.ctx.drawImage(this.temp, 0, 0)
    this.ctx.globalAlpha = 1
  }
}

const canvasFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

const patch = document.createElement('canvas')
const patchCtx = patch.getContext('2d')!
const strip = document.createElement('canvas')
const stripCtx = strip.getContext('2d')!

/**
 * Paints over objects on a frame that is already drawn on `ctx` (size w×h).
 * Each box is filled from the clean plate where it has seen the area clear,
 * and elsewhere from the surrounding pixels stretched inward, then feathered into the frame.
 */
export function removeObjects(ctx: CanvasRenderingContext2D, frame: CanvasImageSource, w: number, h: number, boxes: Box[], plate: CleanPlate | null) {
  for (const raw of boxes) {
    const b = padBox(raw, 0.14)
    const bx = Math.round(b.x * w)
    const by = Math.round(b.y * h)
    const bw = Math.max(4, Math.round(b.w * w))
    const bh = Math.max(4, Math.round(b.h * h))
    const feather = Math.max(4, Math.round(Math.min(bw, bh) * 0.12))
    if (patch.width !== bw || patch.height !== bh) {
      patch.width = bw
      patch.height = bh
    }
    patchCtx.globalCompositeOperation = 'source-over'
    patchCtx.globalAlpha = 1
    patchCtx.clearRect(0, 0, bw, bh)

    // 1. Surroundings: the bands just outside each side, stretched toward the middle.
    const band = Math.max(3, Math.round(Math.min(bw, bh) * 0.08))
    const sides: [number, number, number, number, 'v' | 'h', boolean][] = [
      [bx, by - band, bw, band, 'v', false],
      [bx, by + bh, bw, band, 'v', true],
      [bx - band, by, band, bh, 'h', false],
      [bx + bw, by, band, bh, 'h', true],
    ]
    let first = true
    for (const [sx, sy, sw, sh, dir, far] of sides) {
      const cx = Math.max(0, Math.min(w - 1, sx))
      const cy = Math.max(0, Math.min(h - 1, sy))
      const cw = Math.max(1, Math.min(w - cx, sw))
      const ch = Math.max(1, Math.min(h - cy, sh))
      if (strip.width !== bw || strip.height !== bh) {
        strip.width = bw
        strip.height = bh
      }
      stripCtx.globalCompositeOperation = 'copy'
      stripCtx.drawImage(frame, cx, cy, cw, ch, 0, 0, bw, bh)
      if (!first) {
        // Fade each side out toward the opposite edge so the four blend into one fill.
        const g = dir === 'v' ? stripCtx.createLinearGradient(0, far ? bh : 0, 0, far ? 0 : bh) : stripCtx.createLinearGradient(far ? bw : 0, 0, far ? 0 : bw, 0)
        g.addColorStop(0, 'rgba(0,0,0,1)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        stripCtx.globalCompositeOperation = 'destination-in'
        stripCtx.fillStyle = g
        stripCtx.fillRect(0, 0, bw, bh)
      }
      patchCtx.globalAlpha = first ? 1 : 0.6
      patchCtx.drawImage(strip, 0, 0)
      first = false
    }
    patchCtx.globalAlpha = 1
    // Soften the stretched bands into a smooth fill.
    if (canvasFilter) {
      patchCtx.filter = `blur(${Math.max(2, Math.round(Math.min(bw, bh) / 14))}px)`
      patchCtx.drawImage(patch, 0, 0)
      patchCtx.filter = 'none'
    }

    // 2. Real background from the clean plate, where it has been seen.
    if (plate && plate.canvas.width) {
      const sx = plate.canvas.width / w
      const sy = plate.canvas.height / h
      patchCtx.drawImage(plate.canvas, bx * sx, by * sy, bw * sx, bh * sy, 0, 0, bw, bh)
    }

    // 3. Feather the edges so the patch melts into the frame.
    patchCtx.globalCompositeOperation = 'destination-in'
    if (canvasFilter) {
      patchCtx.filter = `blur(${feather / 2}px)`
      patchCtx.fillStyle = '#000'
      patchCtx.fillRect(feather, feather, bw - feather * 2, bh - feather * 2)
      patchCtx.filter = 'none'
    } else {
      patchCtx.fillStyle = '#000'
      patchCtx.fillRect(feather / 2, feather / 2, bw - feather, bh - feather)
    }
    patchCtx.globalCompositeOperation = 'source-over'
    ctx.drawImage(patch, bx, by)
  }
}

const LABEL_COLORS = ['#ff8080', '#38bdf8', '#facc15', '#4ade80', '#c084fc', '#fb923c']
export const labelColor = (label: string) => LABEL_COLORS[[...label].reduce((n, c) => n + c.charCodeAt(0), 0) % LABEL_COLORS.length]

/** Draws a labelled box around an object (used when "show labels" is on). */
export function drawLabel(ctx: CanvasRenderingContext2D, o: Detection, w: number, h: number) {
  const x = o.box.x * w
  const y = o.box.y * h
  const color = labelColor(o.label)
  const lw = Math.max(2, h / 300)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.roundRect(x, y, o.box.w * w, o.box.h * h, lw * 3)
  ctx.stroke()
  const text = `${o.label} ${Math.round(o.score * 100)}%`
  ctx.font = `600 ${Math.max(12, Math.round(h / 36))}px Inter, system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const th = Math.max(12, Math.round(h / 36)) * 1.4
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, Math.max(0, y - th), tw + th * 0.6, th, th * 0.25)
  ctx.fill()
  ctx.fillStyle = '#0a0a0b'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + th * 0.3, Math.max(0, y - th) + th / 2)
  ctx.restore()
}

export interface ObjectSummary {
  label: string
  count: number
}

/**
 * Live camera stage: finds objects with ml5.js and removes the chosen kinds in real time.
 * Takes a camera stream and gives back a processed stream; settings can change at any time.
 */
export class ObjectProcessor {
  readonly stream: MediaStream
  /** Object kinds (e.g. "cup", "cell phone") painted out of the video. */
  removed = new Set<string>()
  showLabels = false
  onObjects: ((list: ObjectSummary[]) => void) | null = null
  onStatus: ((s: 'loading' | 'ready' | 'error') => void) | null = null

  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private video: HTMLVideoElement
  private live: LiveFrames | null
  private tracker = new ObjectTracker()
  private plate = new CleanPlate()
  private detector: Ml5ObjectDetector | null = null
  private worker: Worker
  private workerUrl: string
  private stopped = false
  private detecting = false
  private lastReport = 0
  private lastSummary = ''

  constructor(source: MediaStream) {
    this.ctx = this.canvas.getContext('2d', { alpha: false })!
    this.video = makeVideo(source)
    this.live = liveFrames(source)
    this.stream = this.canvas.captureStream(30)
    queueMicrotask(() => this.onStatus?.('loading'))
    loadDetector().then(
      (d) => {
        this.detector = d
        this.onStatus?.('ready')
      },
      () => this.onStatus?.('error'),
    )
    this.workerUrl = URL.createObjectURL(new Blob([TICKER], { type: 'application/javascript' }))
    this.worker = new Worker(this.workerUrl)
    this.worker.onmessage = () => this.tick()
    this.worker.postMessage(Math.round(1000 / 30))
  }

  destroy() {
    this.stopped = true
    this.worker.terminate()
    URL.revokeObjectURL(this.workerUrl)
    this.live?.stop()
    this.video.pause()
    this.video.srcObject = null
    this.stream.getTracks().forEach((t) => t.stop())
  }

  private tick() {
    const frame = picture(this.video, this.live)
    if (!frame) return
    const { w, h, img } = frame
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const now = performance.now()
    this.tracker.update([], now)
    const objects = this.tracker.objects
    // Learn the empty scene from everything that isn't an object or a person.
    this.plate.update(img, w, h, objects.map((o) => o.box))
    this.ctx.drawImage(img, 0, 0, w, h)
    const gone = objects.filter((o) => this.removed.has(o.label)).map((o) => o.box)
    if (gone.length) removeObjects(this.ctx, img, w, h, gone, this.plate)
    if (this.showLabels) for (const o of objects) if (!this.removed.has(o.label)) drawLabel(this.ctx, o, w, h)
    if (!this.detecting) void this.detect(img, w, h)
    if (now - this.lastReport > 400) this.report(now)
  }

  private async detect(img: CanvasImageSource, w: number, h: number) {
    const d = this.detector
    if (!d) return
    this.detecting = true
    try {
      const found = await detectObjects(d, img, w, h)
      if (!this.stopped) this.tracker.update(found, performance.now())
    } catch {
      // A frame that can't be read is skipped.
    }
    this.detecting = false
  }

  private report(now: number) {
    this.lastReport = now
    const counts = new Map<string, number>()
    for (const o of this.tracker.objects) counts.set(o.label, (counts.get(o.label) ?? 0) + 1)
    const list = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label))
    const key = JSON.stringify(list)
    if (key === this.lastSummary) return
    this.lastSummary = key
    this.onObjects?.(list)
  }
}
