import type { Settings } from './settings'

export const canCaptureScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

/** Phones and tablets switch between front and back cameras; computers pick a device from a list. */
export const isPhone =
  typeof navigator !== 'undefined' &&
  ((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** The back camera is never mirrored: it would flip text in the shot. */
export const isMirrored = (s: Settings) => s.mirrorCamera && (!isPhone || s.cameraFacing === 'user')

export interface DeviceLists {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
}

export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], mics: [] }
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    cameras: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
    mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

export async function getCamera(s: Settings): Promise<MediaStream> {
  const hd = s.cameraResolution === '1080'
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(isPhone ? { facingMode: { ideal: s.cameraFacing } } : { deviceId: s.cameraId ? { exact: s.cameraId } : undefined }),
      width: { ideal: hd ? 1920 : 1280 },
      height: { ideal: hd ? 1080 : 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  })
}

/** Applies the browser's built-in camera background blur when the platform offers it. */
export async function applyBackgroundBlur(stream: MediaStream, enabled: boolean): Promise<boolean> {
  const track = stream.getVideoTracks()[0]
  const caps = track?.getCapabilities?.() as { backgroundBlur?: boolean[] } | undefined
  if (!caps?.backgroundBlur || caps.backgroundBlur.length < 2) return false
  try {
    await track.applyConstraints({ backgroundBlur: enabled } as MediaTrackConstraints)
    return true
  } catch {
    return false
  }
}

export function supportsBackgroundBlur(stream: MediaStream | null): boolean {
  const caps = stream?.getVideoTracks()[0]?.getCapabilities?.() as { backgroundBlur?: boolean[] } | undefined
  return !!caps?.backgroundBlur && caps.backgroundBlur.length > 1
}

export async function getMic(s: Settings): Promise<MediaStream> {
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>
  const audio: MediaTrackConstraints & Record<string, unknown> = {
    deviceId: s.micId ? { exact: s.micId } : undefined,
    echoCancellation: s.echoCancellation,
    // Voice isolation leans on the browser's own suppression first, then our DSP chain.
    noiseSuppression: s.voiceIsolation,
    autoGainControl: s.autoGain,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
  }
  if (supported.voiceIsolation) audio.voiceIsolation = s.voiceIsolation
  return navigator.mediaDevices.getUserMedia({ audio, video: false })
}

export async function getScreen(s: Settings): Promise<MediaStream> {
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: {
      frameRate: { ideal: s.fps, max: s.fps },
      cursor: s.cursor,
    } as MediaTrackConstraints,
    audio: s.systemAudio
      ? ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints)
      : false,
    systemAudio: s.systemAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  }
  return navigator.mediaDevices.getDisplayMedia(options)
}

export function describeMediaError(err: unknown): string {
  const e = err as DOMException
  switch (e?.name) {
    case 'NotAllowedError':
      return 'Permission was denied. Allow access in your browser (and macOS System Settings → Privacy & Security for screen recording).'
    case 'NotFoundError':
      return 'No matching device was found. Check that it is connected.'
    case 'NotReadableError':
      return 'The device is busy or unavailable — another app may be using it.'
    case 'OverconstrainedError':
      return 'The selected device does not support the requested settings.'
    case 'AbortError':
      return 'The request was cancelled.'
    default:
      return e?.message || String(err)
  }
}
