/** Grabs a small JPEG frame from a video blob for the library grid. */
export function makeThumbnail(blob: Blob, width = 480): Promise<{ thumbnail?: Blob; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = url
    let settled = false
    const finish = (r: { thumbnail?: Blob; width?: number; height?: number }) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      v.removeAttribute('src')
      v.load()
      resolve(r)
    }
    v.addEventListener('error', () => finish({}))
    v.addEventListener('loadedmetadata', () => {
      if (!v.videoWidth) return finish({})
      const d = Number.isFinite(v.duration) ? v.duration : 1
      v.currentTime = Math.min(1, d / 3)
    })
    const draw = () => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = Math.round((width * v.videoHeight) / v.videoWidth)
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      c.toBlob((b) => finish({ thumbnail: b ?? undefined, width: v.videoWidth, height: v.videoHeight }), 'image/jpeg', 0.75)
    }
    // 'seeked' can fire before the frame is decoded; wait until it is presented.
    v.addEventListener('seeked', () => {
      let drawn = false
      const once = () => {
        if (drawn) return
        drawn = true
        draw()
      }
      v.requestVideoFrameCallback?.(once)
      setTimeout(once, 500)
    })
    setTimeout(() => finish({}), 8000)
  })
}

export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const c = document.createElement('canvas')
  c.width = video.videoWidth
  c.height = video.videoHeight
  c.getContext('2d')!.drawImage(video, 0, 0)
  return new Promise((r) => c.toBlob(r, 'image/png'))
}
