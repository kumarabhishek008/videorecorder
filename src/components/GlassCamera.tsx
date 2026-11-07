import { useEffect, useRef } from 'react'

/** Camera picture with a frosted copy behind it and a glass sheen on top. Fills a positioned parent. */
export function GlassCamera({ stream, mirror }: { stream: MediaStream; mirror: boolean }) {
  const frost = useRef<HTMLVideoElement>(null)
  const picture = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (frost.current) frost.current.srcObject = stream
    if (picture.current) picture.current.srcObject = stream
  }, [stream])
  const transform = mirror ? 'scaleX(-1)' : undefined
  return (
    <>
      <video ref={frost} className="cam-frost" autoPlay muted playsInline aria-hidden style={{ transform }} />
      <video ref={picture} autoPlay muted playsInline style={{ transform }} aria-label="Camera preview" />
      <span className="cam-sheen" aria-hidden />
    </>
  )
}
