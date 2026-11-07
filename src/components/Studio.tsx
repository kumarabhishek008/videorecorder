import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useToast } from '../hooks/useToast'
import { GlassCamera } from './GlassCamera'
import { AudioMixer } from '../lib/audio'
import { BUBBLE_SIZES, clampLayout, Compositor, outputSize, waitForVideoSize, type BubbleLayout, type Stroke } from '../lib/compositor'
import { createFileInFolder, ensureWriteAccess, getSaveFolder } from '../lib/files'
import { defaultRecordingName, formatBytes, formatDuration, safeFileName } from '../lib/format'
import { isMirrored } from '../lib/media'
import { extensionFor, pickMimeType, Recorder, videoBitrate, type RecordingResult } from '../lib/recorder'
import { clickEffectLabels, usesCamera, usesScreen, type BubbleShape, type ClickEffect, type Mode, type Settings } from '../lib/settings'
import { BubbleOverlay } from './BubbleOverlay'
import {
  IconCamera,
  IconCameraOff,
  IconClick,
  IconFlip,
  IconMic,
  IconMicOff,
  IconPause,
  IconPen,
  IconPlay,
  IconPopout,
  IconResize,
  IconRestart,
  IconShape,
  IconSpotlight,
  IconStop,
  IconTrash,
  IconZoom,
} from './Icons'
import { LevelBar, VoiceOrb } from './LevelBar'
import { openPipWindow, PipPortal, pipSupported } from './Pip'

export interface FinishedRecording extends RecordingResult {
  name: string
  mode: Mode
}

type Phase = 'countdown' | 'starting' | 'recording' | 'paused' | 'finishing'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => void
  screenStream: MediaStream | null
  camStream: MediaStream | null
  micStream: MediaStream | null
  canFlip: boolean
  initialPip: Window | null
  onFinished: (r: FinishedRecording) => void
  onCancel: () => void
}

const PEN_COLORS = ['#ff8080', '#ffffff', '#facc15', '#22c55e', '#0ea5e9']
const SHAPES: BubbleShape[] = ['circle', 'rounded', 'square']
const CLICK_TOOLS: { effect: ClickEffect; icon: typeof IconZoom }[] = [
  { effect: 'zoom', icon: IconZoom },
  { effect: 'spotlight', icon: IconSpotlight },
  { effect: 'highlight', icon: IconClick },
]

/** Size of the always-on-top window for each layout. */
export const pipSize = (withCamera: boolean) => (withCamera ? { width: 260, height: 260 } : { width: 360, height: 72 })

function relativePoint(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
}

export function Studio({ settings: s, update, screenStream, camStream, micStream, canFlip, initialPip, onFinished, onCancel }: Props) {
  const toast = useToast()
  const isAudio = s.mode === 'audio'
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<Phase>('countdown')
  const [count, setCount] = useState(s.countdown)
  const [elapsed, setElapsed] = useState(0)
  const [bytes, setBytes] = useState(0)
  const [micMuted, setMicMuted] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [pen, setPen] = useState(false)
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [layout, setLayout] = useState<BubbleLayout>({ x: 0.86, y: 0.76, size: BUBBLE_SIZES[1] })
  const [aspect, setAspect] = useState(16 / 9)
  const [pip, setPip] = useState<Window | null>(initialPip)

  const compRef = useRef<Compositor | null>(null)
  const mixerRef = useRef<AudioMixer | null>(null)
  const recRef = useRef<Recorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const diskFile = useRef<{ dir: FileSystemDirectoryHandle; name: string } | null>(null)
  const nameRef = useRef(defaultRecordingName())
  const canvasHost = useRef<HTMLDivElement>(null)
  const stroke = useRef<Stroke | null>(null)

  // Build the pipeline once: compositor canvas (video) + audio mixer → one MediaStream.
  useEffect(() => {
    let cancelled = false
    const mixer = new AudioMixer()
    mixerRef.current = mixer
    void mixer.resume()
    mixer.setSystem(screenStream)
    let comp: Compositor | null = null
    void (async () => {
      let videoTracks: MediaStreamTrack[] = []
      if (!isAudio) {
        let size
        const source = screenStream ?? camStream
        if (source) {
          // Follow the real picture so a phone held upright records a portrait video.
          const src = await waitForVideoSize(source)
          size = outputSize(src.width, src.height, s.resolution)
        } else {
          const hd = s.cameraResolution === '1080'
          size = outputSize(hd ? 1920 : 1280, hd ? 1080 : 720, s.resolution)
        }
        if (cancelled) return
        comp = new Compositor(size.width, size.height)
        compRef.current = comp
        comp.setScreen(screenStream)
        comp.start(s.fps)
        videoTracks = comp.captureStream(s.fps).getVideoTracks()
        canvasHost.current?.appendChild(comp.canvas)
        setAspect(comp.aspect)
      }
      streamRef.current = new MediaStream([...videoTracks, ...mixer.stream.getAudioTracks()])
      setReady(true)
    })()
    return () => {
      cancelled = true
      comp?.destroy()
      comp?.canvas.remove()
      compRef.current = null
      mixer.close()
      mixerRef.current = null
      setReady(false)
    }
    // The pipeline is fixed for the session; live settings are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void mixerRef.current?.setMic(micStream, { voiceIsolation: s.voiceIsolation, noiseGate: s.noiseGate })
  }, [micStream, s.voiceIsolation, s.noiseGate, ready])
  useEffect(() => mixerRef.current?.setMicVolume(s.micGain), [s.micGain, ready])
  useEffect(() => mixerRef.current?.setSystemVolume(s.systemGain), [s.systemGain, ready])
  useEffect(() => mixerRef.current?.setMicMuted(micMuted), [micMuted, ready])

  // The floating window shows only your camera. When the whole screen is shared that real window is
  // captured, so the bubble isn't drawn again; for a single tab or window it's drawn into the video.
  const floatingCamMode = s.mode === 'screen-camera'
  const sharedSurface = screenStream?.getVideoTracks()[0]?.getSettings().displaySurface
  const floatingCam = floatingCamMode && !!pip && sharedSurface === 'monitor'
  const mirror = isMirrored(s)
  // While a phone flips cameras the stream is briefly null; the last frame holds until the new one arrives.
  useEffect(() => {
    if (camStream && usesCamera(s.mode)) compRef.current?.setCamera(camStream)
  }, [camStream, s.mode, ready])
  useEffect(() => {
    const c = compRef.current
    if (!c) return
    c.shape = s.bubbleShape
    c.mirror = mirror
    c.cameraZoom = s.cameraZoom
    c.cameraVisible = camOn
    c.drawBubble = !floatingCam
    c.layout = layout
    c.clickEffect = pen ? 'off' : s.clickEffect
    c.zoomLevel = s.zoomLevel
  }, [s.bubbleShape, s.cameraZoom, mirror, camOn, floatingCam, layout, pen, s.clickEffect, s.zoomLevel, ready])

  const begin = useCallback(async () => {
    const stream = streamRef.current
    if (!stream || recRef.current) return
    setPhase('starting')
    const mimeType = pickMimeType(s.format, isAudio ? 'audio' : 'video')
    if (!mimeType) toast('This browser has no preferred recording format; using its default.', 'info')
    let file: FileSystemFileHandle | undefined
    if (s.recordToDisk) {
      const dir = await getSaveFolder()
      if (dir && (await ensureWriteAccess(dir, false))) {
        file = await createFileInFolder(dir, safeFileName(nameRef.current), extensionFor(mimeType))
        diskFile.current = { dir, name: file.name }
      } else {
        toast('No folder access, so this recording is kept in memory. Choose the folder again in settings.', 'error')
      }
    }
    const comp = compRef.current
    const rec = new Recorder(stream, {
      mimeType,
      videoBitsPerSecond: comp ? videoBitrate(comp.width, comp.height, s.fps, s.quality) : undefined,
      audioBitsPerSecond: s.quality === 'low' ? 96_000 : 160_000,
      file,
    })
    rec.onError = (e) => toast(`Recording error: ${(e as Error)?.message ?? e}`, 'error')
    recRef.current = rec
    try {
      await rec.start()
      setPhase('recording')
    } catch (e) {
      recRef.current = null
      toast(`Could not start recording: ${(e as Error).message}`, 'error')
      onCancel()
    }
  }, [s.format, s.recordToDisk, s.fps, s.quality, isAudio, toast, onCancel])

  // Countdown, then start.
  useEffect(() => {
    if (!ready || phase !== 'countdown') return
    if (count <= 0) {
      void begin()
      return
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [ready, phase, count, begin])

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return
    const t = setInterval(() => {
      const r = recRef.current
      if (!r) return
      setElapsed(r.elapsed())
      setBytes(r.bytes)
    }, 250)
    return () => clearInterval(t)
  }, [phase])

  const throwAway = async () => {
    const rec = recRef.current
    recRef.current = null
    await rec?.discard()
    const f = diskFile.current
    diskFile.current = null
    if (f) await f.dir.removeEntry(f.name).catch(() => {})
  }

  const togglePause = () => {
    const rec = recRef.current
    if (!rec) return
    if (phase === 'recording') {
      rec.pause()
      setPhase('paused')
    } else if (phase === 'paused') {
      rec.resume()
      setPhase('recording')
    }
  }

  const finish = async () => {
    const rec = recRef.current
    if (!rec || phase === 'finishing') return
    setPhase('finishing')
    recRef.current = null
    try {
      const result = await rec.stop()
      pip?.close()
      onFinished({ ...result, name: nameRef.current, mode: s.mode })
    } catch (e) {
      toast(`Could not finish the recording: ${(e as Error).message}`, 'error')
      onCancel()
    }
  }

  const restart = async () => {
    await throwAway()
    nameRef.current = defaultRecordingName()
    setElapsed(0)
    setBytes(0)
    setCount(s.countdown)
    setPhase('countdown')
  }

  const cancel = async (ask = true) => {
    if (ask && recRef.current && recRef.current.elapsed() > 3000 && !window.confirm('Discard this recording? This cannot be undone.')) return
    await throwAway()
    pip?.close()
    onCancel()
  }

  const startNow = () => setCount(0)

  const cycleSize = () =>
    setLayout((l) => {
      const i = BUBBLE_SIZES.findIndex((v) => v > l.size + 0.01)
      return clampLayout({ ...l, size: i === -1 ? BUBBLE_SIZES[0] : BUBBLE_SIZES[i] }, aspect)
    })

  const cycleShape = () => update({ bubbleShape: SHAPES[(SHAPES.indexOf(s.bubbleShape) + 1) % SHAPES.length] })

  const chooseEffect = (effect: ClickEffect) => {
    setPen(false)
    update({ clickEffect: !pen && s.clickEffect === effect ? 'off' : effect })
  }

  const popOut = async () => {
    try {
      const { width, height } = pipSize(floatingCamMode)
      setPip(await openPipWindow(width, height))
    } catch (e) {
      toast(`Could not open floating window: ${(e as Error).message}`, 'error')
    }
  }
  const closePip = useCallback(() => setPip(null), [])

  // Latest handlers for listeners registered once.
  const actions = useRef({ finish, cancel, togglePause })
  actions.current = { finish, cancel, togglePause }

  // "Stop sharing" in the browser bar finishes the recording.
  useEffect(() => {
    const track = screenStream?.getVideoTracks()[0]
    if (!track) return
    const onEnded = () => (recRef.current ? void actions.current.finish() : void actions.current.cancel(false))
    track.addEventListener('ended', onEnded)
    return () => track.removeEventListener('ended', onEnded)
  }, [screenStream])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return compRef.current?.resetEffects()
      if (!e.altKey || !e.shiftKey) return
      const map: Record<string, () => void> = {
        KeyP: () => actions.current.togglePause(),
        KeyS: () => void actions.current.finish(),
        KeyM: () => setMicMuted((m) => !m),
        KeyC: () => setCamOn((c) => !c),
        KeyD: () => setPen((p) => !p),
      }
      const fn = map[e.code]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    pip?.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      pip?.removeEventListener('keydown', onKey)
    }
  }, [pip])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (recRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Clicking the preview zooms / spotlights / highlights there; with the pen it draws (strokes fade out).
  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    const comp = compRef.current
    if (!comp || e.button !== 0) return
    const p = relativePoint(e)
    if (!pen) return comp.click(p.x, p.y)
    e.currentTarget.setPointerCapture(e.pointerId)
    stroke.current = { color: penColor, points: [p], endedAt: null }
    comp.strokes.push(stroke.current)
  }
  const onStageMove = (e: PointerEvent<HTMLDivElement>) => stroke.current?.points.push(relativePoint(e))
  const onStageUp = () => {
    if (stroke.current) stroke.current.endedAt = performance.now()
    stroke.current = null
  }

  const micLevel = useCallback(() => mixerRef.current?.level('mic') ?? 0, [])
  const showBubble = s.mode === 'screen-camera' && camOn && !!camStream && !floatingCam
  const live = phase === 'recording' || phase === 'paused'
  const statusText = phase === 'countdown' ? `Starting in ${count}` : phase === 'starting' ? 'Starting…' : phase === 'paused' ? 'Paused' : phase === 'finishing' ? 'Saving…' : 'Recording'
  const stageCursor = pen ? 'stage-pen' : s.clickEffect === 'zoom' ? (s.zoomLevel < 1 ? 'stage-zoom-out' : 'stage-zoom') : s.clickEffect === 'off' ? '' : 'stage-click'

  const bubbleProps = { layout, shape: s.bubbleShape, aspect, onChange: setLayout, onCycleSize: cycleSize }

  return (
    <div className="studio">
      <div className="stage-wrap">
        {isAudio ? (
          <div className="audio-stage">
            <VoiceOrb getLevel={micLevel} />
            <div className="timer timer-big" aria-hidden>
              {formatDuration(elapsed)}
            </div>
          </div>
        ) : (
          <div
            className={`stage ${stageCursor}`}
            style={{ aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` }}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
            onPointerCancel={onStageUp}
          >
            <div ref={canvasHost} className="canvas-host" />
            {!ready && <div className="stage-loading">Preparing preview…</div>}
            {showBubble && <BubbleOverlay {...bubbleProps} />}
          </div>
        )}
      </div>

      {usesScreen(s.mode) && pipSupported && (
        <p className="stage-hint">
          {pip ? (
            floatingCam ? (
              'Your camera is in its own floating window and is recorded with your screen. Drag its edges to resize it and move it anywhere.'
            ) : floatingCamMode ? (
              'Your camera floats over your apps so you can see yourself. In the video it sits where the bubble is here.'
            ) : (
              'Recording controls are in the small floating window.'
            )
          ) : (
            <>
              <button type="button" className="link-btn" onClick={() => void popOut()}>
                {floatingCamMode ? 'Open the floating camera window' : 'Open floating controls'}
              </button>{' '}
              to keep {floatingCamMode ? 'your face' : 'the controls'} on top of other apps while you record.
            </>
          )}
        </p>
      )}

      {phase === 'countdown' && ready && (
        <div className="countdown" role="dialog" aria-label="Recording countdown">
          <div className="countdown-ring">
            <div className="countdown-num" aria-live="assertive">
              {count}
            </div>
          </div>
          <div className="row gap-s">
            <button type="button" className="btn btn-primary" onClick={startNow}>
              Start now
            </button>
            <button type="button" className="btn btn-light" onClick={() => void cancel(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="controlbar" role="toolbar" aria-label="Recording controls">
        <div className="status">
          <span className={`rec-dot ${phase === 'recording' ? 'rec-dot-live' : ''}`} aria-hidden />
          <span className="status-text">{statusText}</span>
          <span className="timer" aria-label={`Elapsed ${formatDuration(elapsed)}`}>
            {formatDuration(elapsed)}
          </span>
          {bytes > 0 && <span className="muted small">{formatBytes(bytes)}</span>}
        </div>

        <div className="controls">
          <button type="button" className="icon-btn" onClick={togglePause} disabled={!live} aria-label={phase === 'paused' ? 'Resume' : 'Pause'} title="Pause / resume (Alt+Shift+P)">
            {phase === 'paused' ? <IconPlay /> : <IconPause />}
          </button>
          <button type="button" className="btn btn-finish" onClick={() => void finish()} disabled={!live} title="Finish (Alt+Shift+S)">
            <IconStop /> Finish
          </button>
          <button type="button" className="icon-btn" onClick={() => void restart()} disabled={!live} aria-label="Restart recording" title="Restart">
            <IconRestart />
          </button>
          <button type="button" className="icon-btn icon-danger" onClick={() => void cancel()} aria-label="Discard recording" title="Discard">
            <IconTrash />
          </button>

          <span className="divider" aria-hidden />

          <button type="button" className={`icon-btn ${micMuted ? 'icon-off' : ''}`} onClick={() => setMicMuted((m) => !m)} aria-pressed={micMuted} aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'} title="Mute (Alt+Shift+M)" disabled={!micStream}>
            {micMuted || !micStream ? <IconMicOff /> : <IconMic />}
          </button>
          {micStream && <LevelBar getLevel={micLevel} label="Recording level" vertical />}
          {usesCamera(s.mode) && (
            <button type="button" className={`icon-btn ${!camOn ? 'icon-off' : ''}`} onClick={() => setCamOn((c) => !c)} aria-pressed={!camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'} title="Camera (Alt+Shift+C)">
              {camOn ? <IconCamera /> : <IconCameraOff />}
            </button>
          )}
          {usesCamera(s.mode) && canFlip && (
            <button type="button" className="icon-btn" onClick={() => update({ cameraFacing: s.cameraFacing === 'user' ? 'environment' : 'user' })} aria-label={s.cameraFacing === 'user' ? 'Switch to back camera' : 'Switch to front camera'} title="Switch camera">
              <IconFlip />
            </button>
          )}
          {s.mode === 'screen-camera' && (
            <>
              <button type="button" className="icon-btn" onClick={cycleSize} aria-label="Change bubble size" title="Bubble size">
                <IconResize />
              </button>
              <button type="button" className="icon-btn" onClick={cycleShape} aria-label={`Bubble shape: ${s.bubbleShape}`} title="Change bubble shape">
                <IconShape />
              </button>
            </>
          )}

          {!isAudio && (
            <>
              <span className="divider" aria-hidden />
              <div className="tool-group" role="group" aria-label="Click effects">
                {CLICK_TOOLS.map(({ effect, icon: Icon }) => (
                  <button
                    key={effect}
                    type="button"
                    className={`icon-btn ${!pen && s.clickEffect === effect ? 'icon-active' : ''}`}
                    aria-pressed={!pen && s.clickEffect === effect}
                    aria-label={`Click to ${clickEffectLabels[effect].toLowerCase()}`}
                    title={`Click on the preview: ${clickEffectLabels[effect]}`}
                    onClick={() => chooseEffect(effect)}
                  >
                    <Icon />
                  </button>
                ))}
                <button type="button" className={`icon-btn ${pen ? 'icon-active' : ''}`} onClick={() => setPen((p) => !p)} aria-pressed={pen} aria-label="Draw on the video" title="Draw (Alt+Shift+D)">
                  <IconPen />
                </button>
              </div>
              {pen && (
                <div className="swatches" role="radiogroup" aria-label="Pen color">
                  {PEN_COLORS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={penColor === c} aria-label={c} className={`swatch ${penColor === c ? 'swatch-on' : ''}`} style={{ background: c }} onClick={() => setPenColor(c)} />
                  ))}
                </div>
              )}
            </>
          )}
          {pipSupported && !isAudio && (
            <button type="button" className={`icon-btn ${pip ? 'icon-active' : ''}`} onClick={() => (pip ? pip.close() : void popOut())} aria-pressed={!!pip} aria-label="Floating mini-window" title="Floating mini-window (always on top)">
              <IconPopout />
            </button>
          )}
        </div>
      </div>

      {pip && (
        <PipPortal win={pip} onClose={closePip}>
          <div className={`pip ${floatingCamMode ? 'pip-face' : 'pip-compact'}`}>
            {floatingCamMode && <PipCamera stream={camOn ? camStream : null} mirror={mirror} shape={s.bubbleShape} zoom={s.cameraZoom} />}
            <div className="pip-bar">
              <span className={`rec-dot ${phase === 'recording' ? 'rec-dot-live' : ''}`} aria-hidden />
              <span className="timer">{phase === 'countdown' ? count : formatDuration(elapsed)}</span>
              <button type="button" className="icon-btn" onClick={togglePause} disabled={!live} aria-label={phase === 'paused' ? 'Resume' : 'Pause'}>
                {phase === 'paused' ? <IconPlay /> : <IconPause />}
              </button>
              <button type="button" className={`icon-btn ${micMuted ? 'icon-off' : ''}`} onClick={() => setMicMuted((m) => !m)} aria-label={micMuted ? 'Unmute' : 'Mute'}>
                {micMuted ? <IconMicOff /> : <IconMic />}
              </button>
              <button type="button" className="btn btn-finish btn-small" onClick={() => void finish()} disabled={!live} aria-label="Finish recording">
                <IconStop width={14} height={14} />
                {!floatingCamMode && 'Finish'}
              </button>
            </div>
          </div>
        </PipPortal>
      )}
    </div>
  )
}

/** Loom-style camera bubble that fills the floating window. */
function PipCamera({ stream, mirror, shape, zoom }: { stream: MediaStream | null; mirror: boolean; shape: BubbleShape; zoom: number }) {
  return (
    <div className={`pip-cam pip-cam-${shape}`} style={{ '--cam-zoom': zoom } as CSSProperties}>
      {stream ? <GlassCamera stream={stream} mirror={mirror} /> : <IconCameraOff width={32} height={32} />}
    </div>
  )
}
