import { useCallback, useEffect, useState } from 'react'
import { applyBackgroundBlur, describeMediaError, getCamera, getMic, listDevices, stopStream, supportsBackgroundBlur, type DeviceLists } from '../lib/media'
import { usesCamera, type Settings } from '../lib/settings'

/** Keeps live camera and mic streams that match the current settings. Shared by setup preview and recording. */
export function useMediaSources(s: Settings) {
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], mics: [] })
  const [camStream, setCamStream] = useState<MediaStream | null>(null)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  const refreshDevices = useCallback(() => {
    listDevices().then(setDevices).catch(() => {})
  }, [])

  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  const wantCamera = usesCamera(s.mode)
  useEffect(() => {
    if (!wantCamera) return
    let cancelled = false
    let stream: MediaStream | null = null
    setCamError(null)
    getCamera(s)
      .then((st) => {
        if (cancelled) return stopStream(st)
        stream = st
        setCamStream(st)
        refreshDevices()
        // A device that was unplugged ends its track; drop it so the UI can show that.
        st.getVideoTracks()[0]?.addEventListener('ended', () => setCamError('Camera disconnected.'))
      })
      .catch((e) => !cancelled && setCamError(describeMediaError(e)))
    return () => {
      cancelled = true
      stopStream(stream)
      setCamStream(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCamera, s.cameraId, s.cameraResolution, retry, refreshDevices])

  useEffect(() => {
    if (camStream) void applyBackgroundBlur(camStream, s.backgroundBlur)
  }, [camStream, s.backgroundBlur])

  useEffect(() => {
    if (!s.micEnabled) return
    let cancelled = false
    let stream: MediaStream | null = null
    setMicError(null)
    getMic(s)
      .then((st) => {
        if (cancelled) return stopStream(st)
        stream = st
        setMicStream(st)
        refreshDevices()
      })
      .catch((e) => !cancelled && setMicError(describeMediaError(e)))
    return () => {
      cancelled = true
      stopStream(stream)
      setMicStream(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.micEnabled, s.micId, s.echoCancellation, s.voiceIsolation, s.autoGain, retry, refreshDevices])

  return {
    devices,
    camStream: wantCamera ? camStream : null,
    micStream: s.micEnabled ? micStream : null,
    camError: wantCamera ? camError : null,
    micError: s.micEnabled ? micError : null,
    blurSupported: supportsBackgroundBlur(camStream),
    retry: () => setRetry((n) => n + 1),
  }
}

export type MediaSources = ReturnType<typeof useMediaSources>
