// The editor's project model: tracks hold clips laid out on one timeline (seconds).
import type { Box } from '../lib/objects'

export type TrackKind = 'video' | 'audio' | 'text'
export type AssetKind = 'video' | 'audio' | 'image'

export interface Asset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  /** Seconds; images are given a default length when placed. */
  duration: number
  width?: number
  height?: number
  hasAudio?: boolean
}

export interface ColorAdjust {
  exposure: number // -1..1 (stops)
  brightness: number // -1..1
  contrast: number // -1..1
  saturation: number // -1..1
  temperature: number // -1..1 (cool..warm)
  tint: number // -1..1 (green..magenta)
  hue: number // -180..180 degrees
  vignette: number // 0..1
  fade: number // 0..1 lifted blacks
  grain: number // 0..1
  sharpen: number // 0..1
}

export const neutralColor: ColorAdjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  vignette: 0,
  fade: 0,
  grain: 0,
  sharpen: 0,
}

export type TransitionType =
  | 'none'
  | 'fade'
  | 'fade-black'
  | 'fade-white'
  | 'zoom-in'
  | 'zoom-out'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'push-left'
  | 'push-right'
  | 'wipe-left'
  | 'wipe-right'
  | 'circle-open'
  | 'blur'
  | 'spin'

export interface Transition {
  type: TransitionType
  duration: number
}

/** Object removal for a clip: what was found while scanning, and which kinds to paint out. */
export interface ClipObjects {
  /** Samples in source time (seconds) with boxes in 0..1 frame coordinates. */
  samples: { t: number; objs: { label: string; box: Box; score: number }[] }[]
  labels: { label: string; count: number }[]
  remove: string[]
}

interface ClipBase {
  id: string
  trackId: string
  /** Where the clip starts on the timeline, seconds. */
  start: number
  duration: number
}

export interface MediaClip extends ClipBase {
  type: 'media'
  assetId: string
  /** Where the clip starts inside its source, seconds. */
  in: number
  volume: number
  muted: boolean
  fadeIn: number
  fadeOut: number
  color: ColorAdjust
  /** Built-in look or imported LUT id. */
  lut: string | null
  lutStrength: number
  transitionIn: Transition
  /** How the clip leaves at its end. Older projects don't have it. */
  transitionOut?: Transition
  /** Placement on the canvas: 1 = fit the frame. */
  scale: number
  x: number
  y: number
  opacity: number
  fit: 'contain' | 'cover'
  objects?: ClipObjects
}

export type TextAnim = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'pop' | 'zoom' | 'typewriter' | 'blur'

export interface TextClip extends ClipBase {
  type: 'text'
  text: string
  /** Second line, used by lower-third style designs. */
  subtitle: string
  style: string
  font: string
  size: number // fraction of frame height
  color: string
  accent: string
  x: number // 0..1 center
  y: number // 0..1 center
  align: 'left' | 'center' | 'right'
  animIn: TextAnim
  animOut: TextAnim
  animDuration: number
  /** How solid the box behind the text is, 0 (clear) to 1. Older projects don't have it. */
  bgOpacity?: number
  /** Blurs the video behind the box, like frosted glass. */
  frosted?: boolean
}

export type Clip = MediaClip | TextClip

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  hidden: boolean
}

export interface Project {
  id: string
  name: string
  width: number
  height: number
  fps: number
  background: string
  /** Bottom to top for video; order shown in the timeline. */
  tracks: Track[]
  clips: Clip[]
  assets: Asset[]
  /** Imported .cube LUTs: id → name (data lives in the store). */
  luts: { id: string; name: string }[]
  updatedAt: number
}

export const isMedia = (c: Clip): c is MediaClip => c.type === 'media'
export const isText = (c: Clip): c is TextClip => c.type === 'text'
export const clipEnd = (c: Clip) => c.start + c.duration

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}
