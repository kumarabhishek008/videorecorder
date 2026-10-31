import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clampLayout, type BubbleLayout } from '../lib/compositor'
import type { BubbleShape } from '../lib/settings'

interface Props {
  layout: BubbleLayout
  shape: BubbleShape
  aspect: number
  onChange: (l: BubbleLayout) => void
  onCycleSize: () => void
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  start: BubbleLayout
  rect: DOMRect
  mode: 'move' | 'resize'
  moved: boolean
}

/**
 * Interactive hit area over the camera bubble on the live preview.
 * Drag to move, click to cycle sizes, drag the corner handle to resize; arrows / +/- for keyboard users.
 */
export function BubbleOverlay({ layout, shape, aspect, onChange, onCycleSize }: Props) {
  const drag = useRef<DragState | null>(null)
  const el = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const stage = el.current?.parentElement
    if (!stage) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const isHandle = (e.target as HTMLElement).dataset.handle === 'resize'
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, start: layout, rect: stage.getBoundingClientRect(), mode: isHandle ? 'resize' : 'move', moved: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    if (d.mode === 'move') {
      onChange(clampLayout({ ...d.start, x: d.start.x + dx / d.rect.width, y: d.start.y + dy / d.rect.height }, aspect))
    } else {
      const cx = d.rect.left + d.start.x * d.rect.width
      const cy = d.rect.top + d.start.y * d.rect.height
      const half = Math.max(Math.abs(e.clientX - cx), Math.abs(e.clientY - cy))
      onChange(clampLayout({ ...d.start, size: (2 * half) / d.rect.height }, aspect))
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (!d.moved && d.mode === 'move') onCycleSize()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.08 : 0.02
    const moves: Record<string, Partial<BubbleLayout>> = {
      ArrowLeft: { x: layout.x - step },
      ArrowRight: { x: layout.x + step },
      ArrowUp: { y: layout.y - step },
      ArrowDown: { y: layout.y + step },
      '+': { size: layout.size + 0.03 },
      '=': { size: layout.size + 0.03 },
      '-': { size: layout.size - 0.03 },
    }
    if (moves[e.key]) {
      e.preventDefault()
      onChange(clampLayout({ ...layout, ...moves[e.key] }, aspect))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCycleSize()
    }
  }

  const w = layout.size / aspect
  return (
    <div
      ref={el}
      className={`bubble-hit bubble-${shape}`}
      style={{ left: `${(layout.x - w / 2) * 100}%`, top: `${(layout.y - layout.size / 2) * 100}%`, width: `${w * 100}%`, height: `${layout.size * 100}%` }}
      role="button"
      tabIndex={0}
      aria-label="Camera bubble. Drag or use arrow keys to move, click or Enter to change size, plus and minus to resize."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
    >
      <span className="bubble-handle" data-handle="resize" aria-hidden />
    </div>
  )
}
