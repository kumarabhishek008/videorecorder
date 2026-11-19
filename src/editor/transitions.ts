// Transitions between two clips on the same track. `p` runs 0 → 1 over the transition.
import type { TransitionType } from './types'

export const TRANSITIONS: { type: TransitionType; name: string }[] = [
  { type: 'none', name: 'Cut' },
  { type: 'fade', name: 'Cross fade' },
  { type: 'fade-black', name: 'Dip to black' },
  { type: 'fade-white', name: 'Dip to white' },
  { type: 'zoom-in', name: 'Zoom in' },
  { type: 'zoom-out', name: 'Zoom out' },
  { type: 'slide-left', name: 'Slide in left' },
  { type: 'slide-right', name: 'Slide in right' },
  { type: 'slide-up', name: 'Slide in up' },
  { type: 'slide-down', name: 'Slide in down' },
  { type: 'push-left', name: 'Push left' },
  { type: 'push-right', name: 'Push right' },
  { type: 'wipe-left', name: 'Wipe left' },
  { type: 'wipe-right', name: 'Wipe right' },
  { type: 'circle-open', name: 'Circle open' },
  { type: 'blur', name: 'Blur' },
  { type: 'spin', name: 'Spin' },
]

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const layerA = document.createElement('canvas')
const layerB = document.createElement('canvas')

type Draw = (ctx: CanvasRenderingContext2D) => void

function layer(c: HTMLCanvasElement, w: number, h: number, draw: Draw) {
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  draw(ctx)
  return c
}

function scaled(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, s: number, alpha: number, w: number, h: number, rot = 0) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(w / 2, h / 2)
  if (rot) ctx.rotate(rot)
  ctx.scale(s, s)
  ctx.drawImage(img, -w / 2, -h / 2)
  ctx.restore()
}

/** Draws outgoing clip A and incoming clip B mixed by `type` at progress p. */
export function drawTransition(ctx: CanvasRenderingContext2D, type: TransitionType, rawP: number, w: number, h: number, drawA: Draw, drawB: Draw) {
  const p = ease(Math.min(1, Math.max(0, rawP)))
  const A = layer(layerA, w, h, drawA)
  const B = layer(layerB, w, h, drawB)
  ctx.save()
  switch (type) {
    case 'fade':
      ctx.drawImage(A, 0, 0)
      ctx.globalAlpha = p
      ctx.drawImage(B, 0, 0)
      break
    case 'fade-black':
    case 'fade-white': {
      ctx.drawImage(p < 0.5 ? A : B, 0, 0)
      ctx.fillStyle = type === 'fade-black' ? '#000' : '#fff'
      ctx.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2
      ctx.fillRect(0, 0, w, h)
      break
    }
    case 'zoom-in':
      scaled(ctx, A, 1 + p * 0.8, 1 - p, w, h)
      scaled(ctx, B, 0.7 + p * 0.3, p, w, h)
      break
    case 'zoom-out':
      scaled(ctx, A, 1 - p * 0.5, 1 - p, w, h)
      scaled(ctx, B, 1.5 - p * 0.5, p, w, h)
      break
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
    case 'slide-down': {
      ctx.drawImage(A, 0, 0)
      const dx = type === 'slide-left' ? (1 - p) * w : type === 'slide-right' ? -(1 - p) * w : 0
      const dy = type === 'slide-up' ? (1 - p) * h : type === 'slide-down' ? -(1 - p) * h : 0
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowBlur = 30
      ctx.drawImage(B, dx, dy)
      break
    }
    case 'push-left':
    case 'push-right': {
      const dir = type === 'push-left' ? -1 : 1
      ctx.drawImage(A, dir * p * w, 0)
      ctx.drawImage(B, dir * (p - 1) * w, 0)
      break
    }
    case 'wipe-left':
    case 'wipe-right': {
      ctx.drawImage(A, 0, 0)
      ctx.beginPath()
      if (type === 'wipe-left') ctx.rect(w * (1 - p), 0, w * p, h)
      else ctx.rect(0, 0, w * p, h)
      ctx.clip()
      ctx.drawImage(B, 0, 0)
      break
    }
    case 'circle-open': {
      ctx.drawImage(A, 0, 0)
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, Math.hypot(w, h) * 0.5 * p, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(B, 0, 0)
      break
    }
    case 'blur': {
      const amt = Math.sin(p * Math.PI) * Math.max(8, w / 80)
      ctx.filter = `blur(${amt}px)`
      ctx.drawImage(A, 0, 0)
      ctx.globalAlpha = p
      ctx.drawImage(B, 0, 0)
      break
    }
    case 'spin':
      scaled(ctx, A, 1 - p * 0.6, 1 - p, w, h, p * Math.PI)
      scaled(ctx, B, 0.4 + p * 0.6, p, w, h, (p - 1) * Math.PI)
      break
    default:
      ctx.drawImage(B, 0, 0)
  }
  ctx.restore()
}
