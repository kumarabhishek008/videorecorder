import { useCallback, useEffect, useRef } from 'react'

const LEFT = { min: 240, max: 440 }
const RIGHT = { min: 280, max: 460 }

/**
 * Sizes the editor's left and right panels to the room the video leaves. The video is as big as
 * the preview height allows; whatever width it can't use goes to the side panels, so there is no
 * empty band beside the picture. Returns a ref for the `.ed-body` element.
 */
export function useSidePanels(aspect: number) {
  const el = useRef<HTMLElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const ratio = useRef(aspect)
  ratio.current = aspect

  const layout = useCallback(() => {
    const body = el.current
    const stage = body?.querySelector<HTMLElement>('.ed-stage')
    if (!body || !stage) return
    const cs = getComputedStyle(body)
    const gap = parseFloat(cs.columnGap) || 0
    const inner = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * 2
    const ss = getComputedStyle(stage)
    const stageH = stage.clientHeight - parseFloat(ss.paddingTop) - parseFloat(ss.paddingBottom)
    const videoW = stageH * ratio.current
    const spare = (inner - videoW) / 2
    const left = Math.round(Math.min(LEFT.max, Math.max(LEFT.min, spare)))
    const right = Math.round(Math.min(RIGHT.max, Math.max(RIGHT.min, spare)))
    body.style.setProperty('--side-l', `${left}px`)
    body.style.setProperty('--side-r', `${right}px`)
  }, [])

  useEffect(() => layout(), [aspect, layout])
  useEffect(() => () => observer.current?.disconnect(), [])

  return useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect()
      el.current = node
      if (!node) return
      // The stage's height doesn't depend on the column widths, so this can't loop.
      observer.current = new ResizeObserver(layout)
      observer.current.observe(node)
      layout()
    },
    [layout],
  )
}
