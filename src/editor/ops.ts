// Pure edits on a project. Each returns a new project and never mutates the old one.
import { newId } from '../lib/storage'
import { TEXT_DESIGNS } from './text'
import { clipEnd, isMedia, neutralColor, type Asset, type Clip, type MediaClip, type Project, type TextClip, type TrackKind } from './types'

export const MIN_CLIP = 0.1

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export function trackEnd(p: Project, trackId: string) {
  return p.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

function firstTrack(p: Project, kind: TrackKind) {
  // Video goes on the bottom video track (the main one); others on their first track.
  const tracks = p.tracks.filter((t) => t.kind === kind)
  return kind === 'video' ? tracks[tracks.length - 1] : tracks[0]
}

export function makeMediaClip(asset: Asset, trackId: string, start: number, id = newId()): MediaClip {
  return {
    id,
    type: 'media',
    trackId,
    start,
    duration: asset.kind === 'image' ? 5 : Math.max(MIN_CLIP, asset.duration),
    assetId: asset.id,
    in: 0,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    color: { ...neutralColor },
    lut: null,
    lutStrength: 1,
    transitionIn: { type: 'none', duration: 0.8 },
    scale: 1,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    fit: 'contain',
  }
}

/** Adds an imported file to the project and places it at the end of a fitting track. */
export function addAsset(p: Project, asset: Asset, place = true, clipId = newId()): { project: Project; clip: MediaClip | null } {
  let project: Project = { ...p, assets: [...p.assets, asset] }
  // The first video sets the canvas size, so recordings export at their own resolution.
  const firstVideo = asset.kind === 'video' && !p.assets.some((a) => a.kind === 'video') && asset.width && asset.height
  if (firstVideo) {
    const s = Math.min(1, 3840 / Math.max(asset.width!, asset.height!))
    project = { ...project, width: even(asset.width! * s), height: even(asset.height! * s) }
  }
  if (!place) return { project, clip: null }
  const track = firstTrack(project, asset.kind === 'audio' ? 'audio' : 'video')
  if (!track) return { project, clip: null }
  const clip = makeMediaClip(asset, track.id, trackEnd(project, track.id), clipId)
  return { project: { ...project, clips: [...project.clips, clip] }, clip }
}

export function addClipAt(p: Project, asset: Asset, trackId: string, start: number, clipId = newId()): { project: Project; clip: MediaClip } {
  const clip = makeMediaClip(asset, trackId, start, clipId)
  return { project: { ...p, clips: [...p.clips, clip] }, clip }
}

/** A text clip in one of the ready-made designs (also used for the gallery previews). */
export function textClipFor(designId: string, trackId: string, at: number, clipId = newId()): TextClip {
  const design = TEXT_DESIGNS.find((d) => d.id === designId) ?? TEXT_DESIGNS[0]
  return {
    id: clipId,
    type: 'text',
    trackId,
    start: at,
    duration: 4,
    text: 'Your text',
    subtitle: '',
    style: design.id,
    font: 'Inter, system-ui, sans-serif',
    size: 0.08,
    color: '#ffffff',
    accent: '#2f6fe4',
    x: 0.5,
    y: 0.5,
    align: 'center',
    animIn: 'fade',
    animOut: 'fade',
    animDuration: 0.6,
    ...design.preset,
  }
}

export function addText(p: Project, designId: string, at: number, clipId = newId()): { project: Project; clip: TextClip | null } {
  let project = p
  let track = firstTrack(project, 'text')
  if (!track) {
    track = { id: newId(), kind: 'text', name: 'Text 1', muted: false, hidden: false }
    project = { ...project, tracks: [track, ...project.tracks] }
  }
  const clip = textClipFor(designId, track.id, at, clipId)
  return { project: { ...project, clips: [...project.clips, clip] }, clip }
}

/**
 * Drops a text design at time `at`. Uses `trackId` when it's a free text track there, else the first
 * text track with room, else a new text track, so dropped text never lands on top of other text.
 */
export function addTextAt(p: Project, designId: string, at: number, trackId: string | null, clipId = newId()): Project {
  const dur = 4
  const free = (id: string) => !p.clips.some((c) => c.trackId === id && c.start < at + dur - 0.01 && clipEnd(c) > at + 0.01)
  const texts = p.tracks.filter((t) => t.kind === 'text')
  let track = texts.find((t) => t.id === trackId && free(t.id)) ?? texts.find((t) => free(t.id))
  let project = p
  if (!track) {
    project = addTrack(p, 'text')
    track = project.tracks.find((t) => t.kind === 'text' && !texts.includes(t))!
  }
  const clip = textClipFor(designId, track.id, Math.max(0, at), clipId)
  return { ...project, clips: [...project.clips, clip] }
}

export function updateClip(p: Project, id: string, patch: Partial<MediaClip> | Partial<TextClip>): Project {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) }
}

export function deleteClips(p: Project, ids: string[]): Project {
  const set = new Set(ids)
  return { ...p, clips: p.clips.filter((c) => !set.has(c.id)) }
}

/** Cuts a clip in two at timeline time `t`. Returns the right-hand part's id. */
export function splitClip(p: Project, id: string, t: number, rightId = newId()): { project: Project; rightId: string | null } {
  const c = p.clips.find((x) => x.id === id)
  if (!c || t <= c.start + MIN_CLIP || t >= clipEnd(c) - MIN_CLIP) return { project: p, rightId: null }
  const left = { ...c, duration: t - c.start } as Clip
  const right = { ...c, id: rightId, start: t, duration: clipEnd(c) - t } as Clip
  if (isMedia(right) && isMedia(c)) {
    right.in = c.in + (t - c.start)
    right.transitionIn = { ...c.transitionIn, type: 'none' }
    // The end transition stays at the clip's end, which is now the right-hand part.
    ;(left as MediaClip).transitionOut = undefined
    right.fadeIn = 0
    ;(left as MediaClip).fadeOut = 0
  }
  const clips = p.clips.flatMap((x) => (x.id === id ? [left, right] : [x]))
  return { project: { ...p, clips }, rightId: right.id }
}

/** Moves a video clip's sound onto its own audio clip, so the two can be edited apart. */
export function detachAudio(p: Project, id: string): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c || !isMedia(c)) return p
  let project = p
  let track = project.tracks.find((t) => t.kind === 'audio')
  if (!track) {
    track = { id: newId(), kind: 'audio', name: 'Audio 1', muted: false, hidden: false }
    project = { ...project, tracks: [...project.tracks, track] }
  }
  const audio: MediaClip = { ...c, id: newId(), trackId: track.id, transitionIn: { type: 'none', duration: 0.8 }, transitionOut: undefined, objects: undefined }
  return { ...project, clips: [...project.clips.map((x) => (x.id === id ? { ...c, muted: true } : x)), audio] }
}

export function addTrack(p: Project, kind: TrackKind): Project {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1
  const label = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Text'
  const track = { id: newId(), kind, name: `${label} ${n}`, muted: false, hidden: false }
  // New video and text tracks go above the existing ones (on top in the picture); audio goes below.
  if (kind === 'audio') return { ...p, tracks: [...p.tracks, track] }
  const firstOfKind = p.tracks.findIndex((t) => t.kind === kind)
  const at = firstOfKind === -1 ? (kind === 'text' ? 0 : p.tracks.findIndex((t) => t.kind === 'audio')) : firstOfKind
  const tracks = [...p.tracks]
  tracks.splice(at === -1 ? tracks.length : at, 0, track)
  return { ...p, tracks }
}

export function removeTrack(p: Project, trackId: string): Project {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: p.clips.filter((c) => c.trackId !== trackId) }
}

/** The clip right before `c` on its track (touching it), which a transition blends from. */
export function previousClip(p: Project, c: Clip): Clip | undefined {
  return p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < 0.05)
}

/** Closes gaps after deleting: shifts later clips on the same track left. */
export function rippleDelete(p: Project, id: string): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  return {
    ...p,
    clips: p.clips.filter((x) => x.id !== id).map((x) => (x.trackId === c.trackId && x.start >= clipEnd(c) - 0.001 ? { ...x, start: x.start - c.duration } : x)),
  }
}
