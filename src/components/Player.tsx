import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { formatDuration } from '../lib/format'
import { Select } from './Select'
import { IconBack5, IconForward5, IconFullscreen, IconFullscreenExit, IconPause, IconPlay, IconPopout, IconRestart, IconVolume, IconVolumeOff, IconWave } from './Icons'

export type PlayerMedia = HTMLVideoElement & HTMLAudioElement

interface Props {
  url: string
  isAudio: boolean
  durationSec: number
  mediaRef: RefObject<PlayerMedia | null>
  /** Range to mark on the timeline, such as the trim selection. */
  selection?: [number, number] | null
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SKIP_SEC = 5
const FRAME_SEC = 1 / 30
const IDLE_MS = 2500

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function Player({ url, isAudio, durationSec, mediaRef, selection }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const idleTimer = useRef(0)
  const resumeAfterScrub = useRef(false)
  const tapOnlyWakes = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationSec)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const chromeVisible = !playing || scrubbing || !idle

  const wake = useCallback(() => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(idleTimer.current), [])

  // Media events only fire a few times a second; follow the playhead smoothly while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (mediaRef.current) setTime(mediaRef.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [playing, mediaRef])

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = speed
  }, [speed, mediaRef])
  useEffect(() => {
    const m = mediaRef.current
    if (!m) return
    m.volume = volume
    m.muted = muted
  }, [volume, muted, mediaRef])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const seek = (t: number) => {
    const m = mediaRef.current
    if (!m) return
    const next = clamp(t, 0, duration)
    m.currentTime = next
    setTime(next)
    setEnded(false)
  }

  const togglePlay = () => {
    const m = mediaRef.current
    if (!m) return
    if (m.paused) void m.play().catch(() => {})
    else m.pause()
  }

  const stepFrame = (dir: number) => {
    mediaRef.current?.pause()
    seek((mediaRef.current?.currentTime ?? 0) + dir * FRAME_SEC)
  }

  const changeVolume = (v: number) => {
    setVolume(clamp(v, 0, 1))
    setMuted(v <= 0)
  }

  const toggleFullscreen = () => {
    const el = root.current
    if (!el) return
    if (document.fullscreenElement === el) void document.exitFullscreen()
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
    // iPhones only allow the video element itself to go fullscreen.
    else (mediaRef.current as (PlayerMedia & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.()
  }

  const togglePip = () => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void mediaRef.current?.requestPictureInPicture().catch(() => {})
  }

  // Latest handlers for the listener registered once.
  const actions = useRef({ togglePlay, seek, stepFrame, changeVolume, toggleFullscreen, wake, volume, setMuted })
  actions.current = { togglePlay, seek, stepFrame, changeVolume, toggleFullscreen, wake, volume, setMuted }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return
      // A focused button already answers to Space.
      if (e.key === ' ' && target.tagName === 'BUTTON') return
      const a = actions.current
      const now = mediaRef.current?.currentTime ?? 0
      const map: Record<string, () => void> = {
        ' ': a.togglePlay,
        k: a.togglePlay,
        arrowleft: () => a.seek(now - SKIP_SEC),
        j: () => a.seek(now - SKIP_SEC),
        arrowright: () => a.seek(now + SKIP_SEC),
        l: () => a.seek(now + SKIP_SEC),
        arrowup: () => a.changeVolume(a.volume + 0.1),
        arrowdown: () => a.changeVolume(a.volume - 0.1),
        ',': () => a.stepFrame(-1),
        '.': () => a.stepFrame(1),
        m: () => a.setMuted((v) => !v),
        f: a.toggleFullscreen,
      }
      const fn = map[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
        a.wake()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mediaRef])

  const timeAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current!.getBoundingClientRect()
    return clamp((e.clientX - r.left) / r.width, 0, 1) * duration
  }

  const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const m = mediaRef.current
    resumeAfterScrub.current = !!m && !m.paused
    m?.pause()
    setScrubbing(true)
    seek(timeAt(e))
  }
  const onTrackMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeAt(e)
    setHover(t)
    if (scrubbing) seek(t)
  }
  const onTrackUp = () => {
    setScrubbing(false)
    if (resumeAfterScrub.current) void mediaRef.current?.play().catch(() => {})
  }

  // On touch screens the first tap only brings the controls back.
  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    tapOnlyWakes.current = e.pointerType !== 'mouse' && !chromeVisible
  }
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.detail <= 2 && !tapOnlyWakes.current) togglePlay()
  }

  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`
  const shared = {
    ref: mediaRef,
    src: url,
    autoPlay: true,
    onPlay: () => {
      setPlaying(true)
      setEnded(false)
      wake()
    },
    onPause: () => setPlaying(false),
    onEnded: () => setEnded(true),
    onTimeUpdate: () => setTime(mediaRef.current?.currentTime ?? 0),
    onDurationChange: () => {
      const d = mediaRef.current?.duration
      if (d && Number.isFinite(d)) setDuration(d)
    },
  }

  return (
    <div ref={root} className={`pl ${chromeVisible ? '' : 'pl-idle'}`} onPointerMove={wake} onPointerDown={wake} onPointerLeave={() => setIdle(true)}>
      <div className="pl-stage" onPointerDown={onStageDown} onClick={onStageClick} onDoubleClick={isAudio ? undefined : toggleFullscreen}>
        {isAudio ? (
          <div className={`pl-audio ${playing ? 'pl-audio-on' : ''}`}>
            <IconWave width={56} height={56} />
            <audio {...shared} />
          </div>
        ) : (
          <video {...shared} playsInline className="pl-video" />
        )}
      </div>

      {!playing && (
        <button type="button" className="pl-big" onClick={togglePlay} aria-label={ended ? 'Play again' : 'Play'}>
          {ended ? <IconRestart width={28} height={28} /> : <IconPlay width={28} height={28} />}
        </button>
      )}

      <div className="pl-chrome">
        <div
          ref={track}
          className={`pl-track ${scrubbing ? 'pl-track-on' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration(duration * 1000)}`}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
          onPointerCancel={onTrackUp}
          onPointerLeave={() => setHover(null)}
        >
          <div className="pl-rail">
            {selection && <div className="pl-selection" style={{ left: pct(selection[0]), right: `calc(100% - ${pct(selection[1])})` }} />}
            <div className="pl-fill" style={{ width: pct(time) }} />
          </div>
          <div className="pl-thumb" style={{ left: pct(time) }} />
          {hover !== null && (
            <span className="pl-tip" style={{ left: `clamp(24px, ${pct(hover)}, calc(100% - 24px))` }}>
              {formatDuration(hover * 1000)}
            </span>
          )}
        </div>

        <div className="pl-bar">
          <button type="button" className="pl-btn pl-btn-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="pl-btn" onClick={() => seek(time - SKIP_SEC)} aria-label="Back 5 seconds" title="Back 5 seconds (←)">
            <IconBack5 />
          </button>
          <button type="button" className="pl-btn" onClick={() => seek(time + SKIP_SEC)} aria-label="Forward 5 seconds" title="Forward 5 seconds (→)">
            <IconForward5 />
          </button>

          <div className="pl-volume">
            <button type="button" className="pl-btn" onClick={() => setMuted((v) => !v)} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute (M)">
              {muted || volume === 0 ? <IconVolumeOff /> : <IconVolume />}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} aria-label="Volume" style={{ '--pl-level': `${(muted ? 0 : volume) * 100}%` } as CSSProperties} />
          </div>

          <span className="pl-time">
            {formatDuration(time * 1000)} <span>/ {formatDuration(duration * 1000)}</span>
          </span>

          <span className="pl-spacer" />

          <Select className="pl-speed" label="Playback speed" title="Playback speed" value={String(speed)} options={SPEEDS.map((v): [string, string] => [String(v), `${v}×`])} onChange={(v) => setSpeed(Number(v))} />
          {!isAudio && document.pictureInPictureEnabled && (
            <button type="button" className="pl-btn" onClick={togglePip} aria-label="Picture-in-picture" title="Picture-in-picture">
              <IconPopout />
            </button>
          )}
          {!isAudio && (
            <button type="button" className="pl-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)">
              {fullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
