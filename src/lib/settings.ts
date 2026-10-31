export type Mode = 'screen-camera' | 'screen' | 'camera' | 'audio'
export type BubbleShape = 'circle' | 'rounded' | 'square'
export type BubbleMode = 'composite' | 'floating'
export type Resolution = 'source' | '720' | '1080' | '1440' | '2160'
export type Quality = 'low' | 'standard' | 'high' | 'max'
export type Format = 'webm' | 'mp4'
export type CursorMode = 'always' | 'motion' | 'never'
export type ClickEffect = 'zoom' | 'spotlight' | 'highlight' | 'off'
export type Theme = 'light' | 'dark'

export interface Settings {
  mode: Mode
  cameraId: string
  micId: string
  micEnabled: boolean
  systemAudio: boolean
  voiceIsolation: boolean
  noiseGate: boolean
  echoCancellation: boolean
  autoGain: boolean
  micGain: number
  systemGain: number
  resolution: Resolution
  fps: number
  quality: Quality
  format: Format
  countdown: number
  cameraResolution: '720' | '1080'
  mirrorCamera: boolean
  backgroundBlur: boolean
  bubbleShape: BubbleShape
  bubbleMode: BubbleMode
  cursor: CursorMode
  keepInLibrary: boolean
  autoSaveToFolder: boolean
  recordToDisk: boolean
  clickEffect: ClickEffect
  zoomLevel: number
  miniWindow: boolean
  theme: Theme
}

export const defaultSettings: Settings = {
  mode: 'screen-camera',
  cameraId: '',
  micId: '',
  micEnabled: true,
  systemAudio: true,
  voiceIsolation: true,
  noiseGate: true,
  echoCancellation: true,
  autoGain: true,
  micGain: 1,
  systemGain: 0.8,
  resolution: '1080',
  fps: 30,
  quality: 'standard',
  format: 'webm',
  countdown: 3,
  cameraResolution: '720',
  mirrorCamera: true,
  backgroundBlur: false,
  bubbleShape: 'circle',
  bubbleMode: 'composite',
  cursor: 'always',
  keepInLibrary: true,
  autoSaveToFolder: false,
  recordToDisk: false,
  clickEffect: 'zoom',
  zoomLevel: 2,
  miniWindow: true,
  theme: 'light',
}

export const usesScreen = (mode: Mode) => mode === 'screen' || mode === 'screen-camera'
export const usesCamera = (mode: Mode) => mode === 'camera' || mode === 'screen-camera'
export const usesVideo = (mode: Mode) => mode !== 'audio'

export const modeLabels: Record<Mode, string> = {
  'screen-camera': 'Screen + Camera',
  screen: 'Screen only',
  camera: 'Camera only',
  audio: 'Audio only',
}

export const clickEffectLabels: Record<ClickEffect, string> = {
  zoom: 'Zoom in',
  spotlight: 'Spotlight',
  highlight: 'Highlight',
  off: 'Off',
}
