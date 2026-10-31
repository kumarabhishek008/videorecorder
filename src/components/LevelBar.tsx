import { useEffect, useRef } from 'react'

/** Audio level meter that animates without re-rendering React. */
export function LevelBar({ getLevel, label, vertical = false }: { getLevel: () => number; label: string; vertical?: boolean }) {
  const fill = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = getLevel()
      if (fill.current) fill.current.style.transform = vertical ? `scaleY(${v})` : `scaleX(${v})`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [getLevel, vertical])
  return (
    <div className={`level ${vertical ? 'level-v' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1}>
      <div ref={fill} className="level-fill" />
    </div>
  )
}

/** Big pulsing ring for audio-only recording. */
export function VoiceOrb({ getLevel }: { getLevel: () => number }) {
  const ring = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = getLevel()
      if (ring.current) ring.current.style.transform = `scale(${1 + v * 0.6})`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [getLevel])
  return (
    <div className="orb" aria-hidden>
      <div ref={ring} className="orb-ring" />
      <div className="orb-core" />
    </div>
  )
}
