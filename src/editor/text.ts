// Designed text for the editor: ready-made styles and in/out animations.
import { ease } from './transitions'
import type { TextAnim, TextClip } from './types'

export interface TextDesign {
  id: string
  name: string
  /** Defaults applied when this design is added. */
  preset: Partial<TextClip>
}

export const FONTS: { value: string; label: string }[] = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter / System' },
  { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: '"Avenir Next", Avenir, "Segoe UI", sans-serif', label: 'Avenir' },
  { value: 'Futura, "Century Gothic", sans-serif', label: 'Futura' },
  { value: '"Arial Black", "Helvetica Neue", sans-serif', label: 'Arial Black' },
  { value: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', label: 'Impact' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: 'Didot, "Bodoni 72", "Playfair Display", serif', label: 'Didot' },
  { value: '"Courier New", Menlo, monospace', label: 'Typewriter' },
  { value: '"Marker Felt", "Comic Sans MS", cursive', label: 'Marker' },
  { value: '"Snell Roundhand", "Brush Script MT", cursive', label: 'Script' },
]

export const TEXT_DESIGNS: TextDesign[] = [
  { id: 'title', name: 'Bold title', preset: { text: 'Your Title', size: 0.12, color: '#ffffff', accent: '#2f6fe4', font: FONTS[0].value, animIn: 'pop', animOut: 'fade', y: 0.45 } },
  { id: 'lower-third', name: 'Lower third', preset: { text: 'Alex Morgan', subtitle: 'Product Designer', size: 0.06, color: '#ffffff', accent: '#3aa6b4', align: 'left', x: 0.08, y: 0.8, animIn: 'slide-right', animOut: 'slide-left' } },
  { id: 'neon', name: 'Neon glow', preset: { text: 'NEON NIGHTS', size: 0.1, color: '#ffffff', accent: '#22d3ee', font: FONTS[3].value, animIn: 'blur', animOut: 'fade' } },
  { id: 'outline', name: 'Outline', preset: { text: 'OUTLINE', size: 0.13, color: '#ffffff', accent: '#111111', font: FONTS[4].value, animIn: 'zoom', animOut: 'fade' } },
  { id: 'boxed', name: 'Boxed', preset: { text: 'Breaking update', size: 0.07, color: '#0a0a0b', accent: '#facc15', animIn: 'slide-up', animOut: 'slide-down' } },
  { id: 'gradient', name: 'Gradient', preset: { text: 'Make it pop', size: 0.12, color: '#f472b6', accent: '#818cf8', font: FONTS[4].value, animIn: 'pop', animOut: 'zoom' } },
  { id: 'retro', name: 'Retro 3D', preset: { text: 'RETRO', size: 0.15, color: '#fde047', accent: '#ef4444', font: FONTS[5].value, animIn: 'slide-down', animOut: 'fade' } },
  { id: 'marker', name: 'Highlighter', preset: { text: 'Key point here', size: 0.075, color: '#0a0a0b', accent: '#a3e635', font: FONTS[9].value, animIn: 'slide-left', animOut: 'fade' } },
  { id: 'caption', name: 'Caption', preset: { text: 'Subtitles go here', size: 0.05, color: '#ffffff', accent: '#000000', y: 0.88, animIn: 'fade', animOut: 'fade' } },
  { id: 'typewriter', name: 'Typewriter', preset: { text: 'Once upon a time…', size: 0.07, color: '#ffffff', accent: '#3aa6b4', font: FONTS[8].value, animIn: 'typewriter', animOut: 'fade' } },
  { id: 'quote', name: 'Quote', preset: { text: 'Simplicity is the ultimate sophistication.', subtitle: '— Leonardo da Vinci', size: 0.065, color: '#ffffff', accent: '#d4bf96', font: FONTS[7].value, animIn: 'fade', animOut: 'fade' } },
  { id: 'impact', name: 'Big impact', preset: { text: 'WOW', size: 0.25, color: '#ffffff', accent: '#2f6fe4', font: FONTS[5].value, animIn: 'zoom', animOut: 'pop' } },
]

export const TEXT_ANIMS: { value: TextAnim; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'slide-left', label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
  { value: 'pop', label: 'Pop' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'blur', label: 'Blur' },
  { value: 'typewriter', label: 'Typewriter' },
]

interface AnimState {
  alpha: number
  dx: number
  dy: number
  scale: number
  blur: number
  chars: number
}

function animState(anim: TextAnim, k: number, entering: boolean, w: number, h: number): AnimState {
  const s: AnimState = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, chars: 1 }
  if (k >= 1 || anim === 'none') return s
  const e = ease(k)
  const away = 1 - e
  // Leaving reverses the direction of travel so text exits the way it was going.
  const dir = entering ? 1 : -1
  switch (anim) {
    case 'fade':
      s.alpha = e
      break
    case 'slide-up':
      s.alpha = e
      s.dy = away * h * 0.08 * dir
      break
    case 'slide-down':
      s.alpha = e
      s.dy = -away * h * 0.08 * dir
      break
    case 'slide-left':
      s.alpha = e
      s.dx = away * w * 0.1 * dir
      break
    case 'slide-right':
      s.alpha = e
      s.dx = -away * w * 0.1 * dir
      break
    case 'pop': {
      // Overshoots a little on the way in.
      const t = k
      s.scale = entering ? (t < 0.7 ? (t / 0.7) * 1.12 : 1.12 - ((t - 0.7) / 0.3) * 0.12) : e
      s.alpha = Math.min(1, k * 2)
      break
    }
    case 'zoom':
      s.alpha = e
      s.scale = entering ? 1.6 - 0.6 * e : e
      break
    case 'blur':
      s.alpha = e
      s.blur = away * h * 0.02
      break
    case 'typewriter':
      s.chars = entering ? k : 1
      if (!entering) s.alpha = e
      break
  }
  return s
}

/** Designs that draw a box behind the text, so their opacity and frost settings apply. */
export const BOXED_DESIGNS = ['lower-third', 'boxed', 'caption', 'marker']
export const DEFAULT_BG_OPACITY = 0.55

/**
 * Fills a box behind text. Frosted boxes first blur the picture already drawn under them, so the
 * video shows through softly; the tint on top is as see-through as the clip's opacity setting.
 */
function glassBox(ctx: CanvasRenderingContext2D, path: () => void, tint: string, opacity: number, frosted: boolean, blur: number) {
  if (frosted && opacity < 0.98) {
    ctx.save()
    path()
    ctx.clip()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.shadowColor = 'transparent'
    ctx.filter = `blur(${Math.max(2, blur)}px)`
    ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0)
    ctx.restore()
  }
  ctx.save()
  ctx.globalAlpha *= opacity
  ctx.fillStyle = tint
  path()
  ctx.fill()
  ctx.restore()
}

function lines(text: string) {
  return text.split('\n')
}

/** Draws a text clip at clip-local time `lt` (seconds) on a w×h canvas. */
export function drawText(ctx: CanvasRenderingContext2D, c: TextClip, lt: number, w: number, h: number) {
  const d = Math.max(0.05, Math.min(c.animDuration, c.duration / 2))
  const kin = Math.min(1, lt / d)
  const kout = Math.min(1, (c.duration - lt) / d)
  const a = kin < 1 ? animState(c.animIn, kin, true, w, h) : animState(c.animOut, kout, false, w, h)
  if (a.alpha <= 0.001) return

  const size = Math.max(8, c.size * h)
  const weight = ['title', 'outline', 'gradient', 'retro', 'impact', 'boxed', 'lower-third'].includes(c.style) ? 800 : c.style === 'neon' ? 600 : 600
  const italic = c.style === 'quote' ? 'italic ' : ''
  ctx.save()
  ctx.globalAlpha = a.alpha
  ctx.translate(c.x * w + a.dx, c.y * h + a.dy)
  if (a.scale !== 1) ctx.scale(a.scale, a.scale)
  if (a.blur > 0.3) ctx.filter = `blur(${a.blur}px)`
  ctx.font = `${italic}${weight} ${size}px ${c.font}`
  ctx.textAlign = c.align
  ctx.textBaseline = 'middle'

  let text = c.text
  if (a.chars < 1) text = text.slice(0, Math.round(text.length * a.chars))
  const ls = lines(text)
  const lh = size * 1.15
  const widths = ls.map((l) => ctx.measureText(l).width)
  const maxW = Math.max(1, ...widths)
  const totalH = lh * ls.length
  const top = -totalH / 2 + lh / 2
  const left = c.align === 'left' ? 0 : c.align === 'right' ? -maxW : -maxW / 2
  const padX = size * 0.45
  const padY = size * 0.3

  const bgOpacity = c.bgOpacity ?? DEFAULT_BG_OPACITY
  const frosted = c.frosted ?? true
  const frost = size * 0.35
  const each = (fn: (l: string, y: number, i: number) => void) => ls.forEach((l, i) => fn(l, top + i * lh, i))

  switch (c.style) {
    case 'lower-third': {
      const subSize = size * 0.55
      const subH = c.subtitle ? subSize * 1.5 : 0
      const boxW = Math.max(maxW, c.subtitle ? (ctx.font = `500 ${subSize}px ${c.font}`, ctx.measureText(c.subtitle).width) : 0) + padX * 2
      ctx.font = `${weight} ${size}px ${c.font}`
      const boxH = totalH + subH + padY * 2
      const bx = c.align === 'left' ? -padX : c.align === 'right' ? -boxW + padX : -boxW / 2
      glassBox(ctx, () => {
        ctx.beginPath()
        ctx.roundRect(bx, top - lh / 2 - padY, boxW, boxH, size * 0.15)
      }, '#0f1726', bgOpacity, frosted, frost)
      ctx.fillStyle = c.accent
      ctx.fillRect(bx, top - lh / 2 - padY, size * 0.14, boxH)
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      if (c.subtitle) {
        ctx.font = `500 ${subSize}px ${c.font}`
        ctx.fillStyle = c.accent
        ctx.fillText(c.subtitle, 0, top + totalH - lh / 2 + subH * 0.6)
      }
      break
    }
    case 'neon':
      ctx.shadowColor = c.accent
      for (const blur of [size * 0.8, size * 0.4, size * 0.15]) {
        ctx.shadowBlur = blur
        ctx.fillStyle = c.accent
        each((l, y) => ctx.fillText(l, 0, y))
      }
      ctx.shadowBlur = size * 0.05
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      break
    case 'outline':
      ctx.lineJoin = 'round'
      ctx.lineWidth = size * 0.12
      ctx.strokeStyle = c.accent
      each((l, y) => ctx.strokeText(l, 0, y))
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      break
    case 'boxed':
    case 'caption': {
      const tint = c.accent
      // Boxed text reads on a strong colour, so it stays a bit more solid than captions.
      const op = c.style === 'boxed' ? Math.min(1, bgOpacity + 0.25) : bgOpacity
      glassBox(ctx, () => {
        ctx.beginPath()
        each((_l, y, i) => {
          const lw = widths[i]
          const lx = c.align === 'left' ? 0 : c.align === 'right' ? -lw : -lw / 2
          ctx.roundRect(lx - padX * 0.7, y - lh / 2 - padY * 0.2, lw + padX * 1.4, lh + padY * 0.4, size * 0.18)
        })
      }, tint, op, frosted, frost)
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      break
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(left, top - lh, left + maxW, top + totalH)
      g.addColorStop(0, c.color)
      g.addColorStop(1, c.accent)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = size * 0.2
      ctx.fillStyle = g
      each((l, y) => ctx.fillText(l, 0, y))
      break
    }
    case 'retro': {
      const depth = Math.max(3, Math.round(size * 0.08))
      ctx.fillStyle = c.accent
      for (let i = depth; i > 0; i--) each((l, y) => ctx.fillText(l, i, y + i))
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      break
    }
    case 'marker': {
      ctx.fillStyle = c.accent
      each((_l, y, i) => {
        const lw = widths[i]
        const lx = c.align === 'left' ? 0 : c.align === 'right' ? -lw : -lw / 2
        ctx.save()
        ctx.globalAlpha *= Math.min(1, bgOpacity + 0.3)
        ctx.transform(1, -0.02, 0, 1, 0, 0)
        ctx.fillRect(lx - padX * 0.3, y - lh * 0.15, lw + padX * 0.6, lh * 0.55)
        ctx.restore()
      })
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      break
    }
    case 'quote': {
      ctx.fillStyle = c.accent
      ctx.font = `700 ${size * 2.2}px Georgia, serif`
      ctx.fillText('“', left - size * 0.2, top - lh * 0.6)
      ctx.font = `${italic}${weight} ${size}px ${c.font}`
      ctx.fillStyle = c.color
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowBlur = size * 0.2
      each((l, y) => ctx.fillText(l, 0, y))
      if (c.subtitle) {
        ctx.font = `500 ${size * 0.55}px ${c.font}`
        ctx.fillStyle = c.accent
        ctx.fillText(c.subtitle, 0, top + totalH)
      }
      break
    }
    case 'impact':
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = size * 0.15
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      ctx.shadowBlur = 0
      ctx.fillStyle = c.accent
      ctx.fillRect(left, top + totalH - lh / 2 + size * 0.1, maxW, size * 0.08)
      break
    default:
      // Bold title, typewriter and anything else: clean fill with a soft shadow.
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = size * 0.25
      ctx.shadowOffsetY = size * 0.04
      ctx.fillStyle = c.color
      each((l, y) => ctx.fillText(l, 0, y))
      if (c.style === 'typewriter' && a.chars < 1 && Math.floor(lt * 3) % 2 === 0) {
        ctx.fillStyle = c.accent
        ctx.fillRect(left + (widths[widths.length - 1] ?? 0) + size * 0.05, top + (ls.length - 1) * lh - size * 0.45, size * 0.08, size * 0.9)
      }
  }
  ctx.restore()
}
