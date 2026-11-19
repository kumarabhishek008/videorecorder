import { useCallback, useEffect, useState } from 'react'
import { BackgroundProcessor, PRESET_BACKGROUNDS } from '../lib/background'
import { getBackground } from '../lib/backgroundStore'
import { ObjectProcessor, type ObjectSummary } from '../lib/objects'
import { applyBackgroundBlur, describeMediaError, getCamera, getMic, isMirrored, isPhone, listDevices, stopStream, supportsBackgroundBlur, type DeviceLists } from '../lib/media'
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
  }, [wantCamera, s.cameraId, s.cameraFacing, s.cameraResolution, retry, refreshDevices])

  useEffect(() => {
    if (camStream) void applyBackgroundBlur(camStream, s.backgroundBlur)
  }, [camStream, s.backgroundBlur])

  // Object detection (ml5.js): first stage after the raw camera, so removed objects are gone
  // before the background effect runs.
  const [objects, setObjects] = useState<ObjectProcessor | null>(null)
  const [objectList, setObjectList] = useState<ObjectSummary[]>([])
  const [objectStatus, setObjectStatus] = useState<'off' | 'loading' | 'ready' | 'error'>('off')
  const objectsOn = wantCamera && s.objectDetection
  useEffect(() => {
    if (!camStream || !objectsOn) return
    const p = new ObjectProcessor(camStream)
    p.onObjects = setObjectList
    p.onStatus = setObjectStatus
    setObjects(p)
    return () => {
      p.destroy()
      setObjects(null)
      setObjectList([])
      setObjectStatus('off')
    }
  }, [camStream, objectsOn])
  useEffect(() => {
    if (!objects) return
    objects.removed = new Set(s.removedObjects)
    objects.showLabels = s.showObjectLabels
  }, [objects, s.removedObjects, s.showObjectLabels])
  const afterObjects = objects?.stream ?? camStream

  // Background blur / picture: the camera is passed through a processor and everything downstream
  // (preview, bubble, floating window, recording) uses its output instead of the raw camera.
  const [processor, setProcessor] = useState<BackgroundProcessor | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const effectOn = wantCamera && s.cameraBackground !== 'none'
  useEffect(() => {
    if (!afterObjects || !effectOn) return
    const p = new BackgroundProcessor(afterObjects)
    setBackgroundError(null)
    p.onError = () => setBackgroundError('Could not load the background effect. Check your internet connection, then pick the effect again.')
    setProcessor(p)
    return () => {
      p.destroy()
      setProcessor(null)
    }
  }, [afterObjects, effectOn])

  const mirror = isMirrored(s)
  useEffect(() => {
    if (!processor) return
    processor.mode = s.cameraBackground
    processor.blur = s.backgroundBlurAmount
    processor.mirror = mirror
  }, [processor, s.cameraBackground, s.backgroundBlurAmount, mirror])

  useEffect(() => {
    if (!processor || s.cameraBackground !== 'image') return
    const preset = PRESET_BACKGROUNDS.find((p) => p.id === s.backgroundImageId)
    if (preset || !s.backgroundImageId) {
      processor.setPreset(preset ?? PRESET_BACKGROUNDS[0])
      return
    }
    let cancelled = false
    void getBackground(s.backgroundImageId)
      .then((bg) => (bg ? createImageBitmap(bg.blob) : null))
      .then((bmp) => {
        if (cancelled) return bmp?.close()
        // The processor owns the picture from here and releases it when it's replaced.
        if (bmp) processor.setImage(bmp, bmp.width, bmp.height)
        else processor.setPreset(PRESET_BACKGROUNDS[0])
      })
      .catch(() => !cancelled && processor.setPreset(PRESET_BACKGROUNDS[0]))
    return () => {
      cancelled = true
    }
  }, [processor, s.cameraBackground, s.backgroundImageId])

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
    camStream: wantCamera ? (processor?.stream ?? afterObjects) : null,
    /** Kinds of objects in view right now, while object detection is on. */
    objectList: objectsOn ? objectList : [],
    objectStatus: objectsOn ? objectStatus : ('off' as const),
    micStream: s.micEnabled ? micStream : null,
    camError: wantCamera ? camError : null,
    backgroundError: effectOn ? backgroundError : null,
    micError: s.micEnabled ? micError : null,
    blurSupported: supportsBackgroundBlur(camStream),
    // Camera names are hidden until permission is granted, so only a known single camera rules it out.
    canFlip: isPhone && devices.cameras.length !== 1,
    retry: () => setRetry((n) => n + 1),
  }
}

export type MediaSources = ReturnType<typeof useMediaSources>
