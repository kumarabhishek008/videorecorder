// Small live previews for the editor's galleries: each design and look is drawn on a sample scene
// with the same code that renders the video, so what you pick is what you get.
import { useEffect, useRef } from 'react'
import { previewLook } from '../../editor/luts'
import { textClipFor } from '../../editor/ops'
import { drawText } from '../../editor/text'

const W = 192
const H = 108

/** A calm landscape in the app's palette: sky, sun, teal sea and sand dunes. */
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62)
  sky.addColorStop(0, '#4f8fe0')
  sky.addColorStop(1, '#b9d6f2')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255, 244, 214, 0.95)'
  ctx.beginPath()
  ctx.arc(w * 0.76, h * 0.3, h * 0.12, 0, Math.PI * 2)
  ctx.fill()
  const sea = ctx.createLinearGradient(0, h * 0.55, 0, h)
  sea.addColorStop(0, '#3aa6b4')
  sea.addColorStop(1, '#1f6f86')
  ctx.fillStyle = sea
  ctx.fillRect(0, h * 0.56, w, h)
  ctx.fillStyle = '#d4bf96'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.78)
  ctx.quadraticCurveTo(w * 0.3, h * 0.64, w * 0.62, h * 0.8)
  ctx.quadraticCurveTo(w * 0.85, h * 0.9, w, h * 0.76)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.fill()
  ctx.fillStyle = '#b89c6c'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.92)
  ctx.quadraticCurveTo(w * 0.5, h * 0.82, w, h * 0.95)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.fill()
}

/** Short words for each design, so long sample text still fits the tiny card. */
const SAMPLE: Record<string, { text: string; subtitle?: string }> = {
  title: { text: 'Big Title' },
  'lower-third': { text: 'Alex Morgan', subtitle: 'Designer' },
  neon: { text: 'NEON' },
  outline: { text: 'OUTLINE' },
  boxed: { text: 'Update' },
  gradient: { text: 'Pop!' },
  retro: { text: 'RETRO' },
  marker: { text: 'Key point' },
  caption: { text: 'Subtitles here' },
  typewriter: { text: 'Once upon…' },
  quote: { text: 'Stay curious.', subtitle: '— Ada' },
  impact: { text: 'WOW' },
}

function useCanvas(draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    draw(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

export function TextPreview({ designId }: { designId: string }) {
  const ref = useCanvas(
    (ctx) => {
      drawScene(ctx, W, H)
      const clip = textClipFor(designId, '', 0, 'preview')
      const sample = SAMPLE[designId]
      if (sample) Object.assign(clip, sample)
      // Small text would be unreadable at card size, so previews use a slightly bigger scale.
      clip.size = Math.min(0.3, clip.size * 1.6)
      if (clip.align === 'left') clip.x = 0.1
      drawText(ctx, clip, clip.duration / 2, W, H)
    },
    [designId],
  )
  return <canvas ref={ref} className="pv" width={W} height={H} aria-hidden />
}

export function LookPreview({ lookId }: { lookId: string | null }) {
  const ref = useCanvas(
    (ctx) => {
      drawScene(ctx, W, H)
      if (!lookId) return
      const img = ctx.getImageData(0, 0, W, H)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = previewLook(lookId, [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255])
        d[i] = r * 255
        d[i + 1] = g * 255
        d[i + 2] = b * 255
      }
      ctx.putImageData(img, 0, 0)
    },
    [lookId],
  )
  return <canvas ref={ref} className="pv" width={W} height={H} aria-hidden />
}
