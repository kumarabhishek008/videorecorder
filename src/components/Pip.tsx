import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture

function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement('style')
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n')
      target.document.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = target.document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.document.head.appendChild(link)
      }
    }
  }
  target.document.documentElement.className = document.documentElement.className
  const theme = document.documentElement.dataset.theme
  if (theme) target.document.documentElement.dataset.theme = theme
  target.document.body.classList.add('pip-body')
}

/** Opens an always-on-top window (Chrome/Edge Document Picture-in-Picture). Must be called from a click. */
export async function openPipWindow(width: number, height: number): Promise<Window | null> {
  if (!window.documentPictureInPicture) return null
  window.documentPictureInPicture.window?.close()
  const win = await window.documentPictureInPicture.requestWindow({ width, height })
  win.document.title = 'Reel'
  copyStyles(win)
  return win
}

export function PipPortal({ win, onClose, children }: { win: Window; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    win.addEventListener('pagehide', onClose)
    return () => win.removeEventListener('pagehide', onClose)
  }, [win, onClose])
  return createPortal(children, win.document.body)
}
