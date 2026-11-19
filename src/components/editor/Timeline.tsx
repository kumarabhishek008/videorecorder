import { useMemo, useRef, useState, type DragEvent as RDragEvent, type PointerEvent as RPointerEvent } from 'react'
import { DND_TEXT, DND_TRANSITION } from '../../editor/dnd'
import { MIN_CLIP, addTextAt, removeTrack, updateClip } from '../../editor/ops'
import { TRANSITIONS } from '../../editor/transitions'
import { clipEnd, isMedia, projectDuration, type Clip, type MediaClip, type Project, type Track, type TransitionType } from '../../editor/types'
import { newId } from '../../lib/storage'
import { formatDuration } from '../../lib/format'
import { IconCamera, IconCameraOff, IconText, IconTrash, IconVolume, IconVolumeOff, IconWave } from '../Icons'

interface Props {
  project: Project
  time: number
  zoom: number
  selectedId: string | null
  thumbs: Map<string, string>
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
  apply: (fn: (p: Project) => Project, key?: string) => void
}

const HEAD_W = 156

/** Keeps receiving pointer moves outside the element while dragging. */
function capture(e: RPointerEvent) {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    // Not an active pointer (e.g. a synthetic event); dragging still works inside the timeline.
  }
}
const SNAP_PX = 8
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

type DropHint =
  | { kind: 'text'; rowId: string; t: number }
  | { kind: 'transition'; rowId: string; clipId: string; edge: 'in' | 'out'; left: number; width: number }

const TEXT_DROP_LEN = 4

interface Drag {
  mode: 'move' | 'trim-l' | 'trim-r'
  clip: Clip
  x: number
  maxDur: number
  minStart: number
}

export function Timeline({ project: p, time, zoom, selectedId, thumbs, onSelect, onSeek, apply }: Props) {
  const lanes = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<Drag | null>(null)
  const [drop, setDrop] = useState<DropHint | null>(null)
  const total = projectDuration(p)
  const width = Math.max(total + 15, 30) * zoom
  const step = STEPS.find((s) => s * zoom >= 70) ?? 600
  const ticks = useMemo(() => Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step), [width, zoom, step])

  const timeAt = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + lanes.current!.scrollLeft - HEAD_W) / zoom)
  }

  const snap = (t: number, ignore: string) => {
    const points = [0, time, ...p.clips.filter((c) => c.id !== ignore).flatMap((c) => [c.start, clipEnd(c)])]
    let best = t
    let dist = SNAP_PX / zoom
    for (const s of points)
      if (Math.abs(s - t) < dist) {
        dist = Math.abs(s - t)
        best = s
      }
    return best
  }

  /** Snaps a span starting at `start` by whichever of its two ends is nearest an edge; unchanged if neither is close. */
  const snapSpan = (start: number, dur: number, ignore: string) => {
    const s1 = snap(start, ignore)
    const s2 = snap(start + dur, ignore) - dur
    const d1 = s1 === start ? Infinity : Math.abs(s1 - start)
    const d2 = s2 === start ? Infinity : Math.abs(s2 - start)
    return d1 === Infinity && d2 === Infinity ? start : d1 <= d2 ? s1 : s2
  }

  const accepts = (track: Track, c: Clip) => {
    if (c.type === 'text') return track.kind === 'text'
    const asset = p.assets.find((a) => a.id === c.assetId)
    return asset?.kind === 'audio' ? track.kind === 'audio' : track.kind === 'video' || (track.kind === 'audio' && asset?.kind === 'video')
  }

  const startDrag = (e: RPointerEvent, c: Clip, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect(c.id)
    capture(e)
    const asset = isMedia(c) ? p.assets.find((a) => a.id === c.assetId) : undefined
    const timed = asset && asset.kind !== 'image'
    drag.current = {
      mode,
      clip: c,
      x: e.clientX,
      // Video and audio can't be stretched past the ends of their source; images and text can.
      maxDur: timed && isMedia(c) ? asset!.duration - c.in : Infinity,
      minStart: timed && isMedia(c) ? Math.max(0, c.start - c.in) : 0,
    }
  }

  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const c = d.clip
    const dt = (e.clientX - d.x) / zoom
    const key = `drag:${c.id}`
    if (d.mode === 'move') {
      const start = snapSpan(Math.max(0, c.start + dt), c.duration, c.id)
      // Moving up or down switches to another track that can hold this clip.
      let trackId = c.trackId
      for (const [id, el] of rows.current) {
        const r = el.getBoundingClientRect()
        const track = p.tracks.find((t) => t.id === id)
        if (track && e.clientY >= r.top && e.clientY < r.bottom && accepts(track, c)) trackId = id
      }
      apply((pp) => updateClip(pp, c.id, { start: Math.max(0, start), trackId }), key)
    } else if (d.mode === 'trim-l') {
      const end = clipEnd(c)
      const start = Math.min(end - MIN_CLIP, Math.max(d.minStart, snap(c.start + dt, c.id)))
      const patch = isMedia(c) ? { start, duration: end - start, in: Math.max(0, c.in + (start - c.start)) } : { start, duration: end - start }
      apply((pp) => updateClip(pp, c.id, patch), key)
    } else {
      const end = Math.max(c.start + MIN_CLIP, Math.min(c.start + d.maxDur, snap(clipEnd(c) + dt, c.id)))
      apply((pp) => updateClip(pp, c.id, { duration: end - c.start }), key)
    }
  }

  const endDrag = () => {
    drag.current = null
  }

  const seekFrom = (e: RPointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    onSeek(timeAt(e.clientX))
  }

  /** Where a dragged text design or transition would land, or null if it can't be dropped here. */
  const hintFor = (e: RDragEvent, track: Track): DropHint | null => {
    const types = e.dataTransfer.types
    const t = timeAt(e.clientX)
    if (types.includes(DND_TEXT)) {
      if (track.kind === 'audio') return null
      // Snap the start, or the end, to the nearest clip edge so text can sit right at the end of a clip.
      return { kind: 'text', rowId: track.id, t: Math.max(0, snapSpan(t, TEXT_DROP_LEN, '')) }
    }
    if (types.includes(DND_TRANSITION)) {
      if (track.kind !== 'video') return null
      const c = p.clips.find((x): x is MediaClip => isMedia(x) && x.trackId === track.id && t >= x.start && t <= clipEnd(x))
      if (!c) return null
      const edge = t < c.start + c.duration / 2 ? 'in' : 'out'
      const len = Math.min(c.duration / 2, (edge === 'in' ? c.transitionIn.duration : c.transitionOut?.duration) || 0.8)
      return { kind: 'transition', rowId: track.id, clipId: c.id, edge, left: edge === 'in' ? c.start : clipEnd(c) - len, width: len }
    }
    return null
  }

  const onDragOver = (e: RDragEvent, track: Track) => {
    const hint = hintFor(e, track)
    if (!hint) {
      if (drop) setDrop(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!drop || drop.rowId !== hint.rowId || (hint.kind === 'text' ? drop.kind !== 'text' || Math.abs(drop.t - hint.t) > 0.01 : drop.kind !== 'transition' || drop.clipId !== hint.clipId || drop.edge !== hint.edge)) setDrop(hint)
  }

  const onDrop = (e: RDragEvent, track: Track) => {
    const hint = hintFor(e, track)
    setDrop(null)
    if (!hint) return
    e.preventDefault()
    if (hint.kind === 'text') {
      const design = e.dataTransfer.getData(DND_TEXT)
      const id = newId()
      apply((pp) => addTextAt(pp, design, hint.t, track.kind === 'text' ? track.id : null, id))
      onSelect(id)
    } else {
      const type = e.dataTransfer.getData(DND_TRANSITION) as TransitionType
      if (!TRANSITIONS.some((x) => x.type === type)) return
      apply((pp) => {
        const c = pp.clips.find((x) => x.id === hint.clipId)
        if (!c || !isMedia(c)) return pp
        const duration = Math.min(c.duration / 2, hint.width || 0.8)
        return updateClip(pp, c.id, hint.edge === 'in' ? { transitionIn: { type, duration } } : { transitionOut: { type, duration } })
      })
      onSelect(hint.clipId)
    }
  }

  const transitionName = (type: string) => TRANSITIONS.find((x) => x.type === type)?.name ?? type

  const toggleTrack = (t: Track, key: 'muted' | 'hidden') => apply((pp) => ({ ...pp, tracks: pp.tracks.map((x) => (x.id === t.id ? { ...x, [key]: !x[key] } : x)) }))

  return (
    <div className="tl-wrap">
    <div
      className="tl"
      ref={lanes}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
      }}
    >
      <div className="tl-inner" style={{ width: width + HEAD_W }}>
        <div className="tl-ruler" onPointerDown={seekFrom} onPointerMove={(e) => e.buttons === 1 && !drag.current && onSeek(timeAt(e.clientX))}>
          <div className="tl-corner">{formatDuration(time * 1000)}</div>
          {ticks.map((t) => (
            <span key={t} className="tl-tick" style={{ left: HEAD_W + t * zoom }}>
              {formatDuration(t * 1000)}
            </span>
          ))}
        </div>

        {p.tracks.map((track) => (
          <div key={track.id} className={`tl-row tl-row-${track.kind} ${drop?.rowId === track.id ? 'tl-row-drop' : ''}`} ref={(el) => {
              if (el) rows.current.set(track.id, el)
              else rows.current.delete(track.id)
            }}>
            <div className="tl-head">
              <span className="tl-kind" aria-hidden>
                {track.kind === 'video' ? <IconCamera width={14} height={14} /> : track.kind === 'audio' ? <IconWave width={14} height={14} /> : <IconText width={14} height={14} />}
              </span>
              <span className="tl-name">{track.name}</span>
              {track.kind !== 'text' && (
                <button type="button" className="tl-btn" onClick={() => toggleTrack(track, 'muted')} aria-pressed={track.muted} aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`} title={track.muted ? 'Unmute' : 'Mute'}>
                  {track.muted ? <IconVolumeOff width={14} height={14} /> : <IconVolume width={14} height={14} />}
                </button>
              )}
              {track.kind !== 'audio' && (
                <button type="button" className="tl-btn" onClick={() => toggleTrack(track, 'hidden')} aria-pressed={track.hidden} aria-label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`} title={track.hidden ? 'Show' : 'Hide'}>
                  {track.hidden ? <IconCameraOff width={14} height={14} /> : <IconCamera width={14} height={14} />}
                </button>
              )}
              <button
                type="button"
                className="tl-btn"
                onClick={() => {
                  const n = p.clips.filter((c) => c.trackId === track.id).length
                  if (!n || window.confirm(`Remove ${track.name} and its ${n} clip${n > 1 ? 's' : ''}?`)) apply((pp) => removeTrack(pp, track.id))
                }}
                aria-label={`Remove ${track.name}`}
                title="Remove track"
              >
                <IconTrash width={14} height={14} />
              </button>
            </div>
            <div
              className="tl-lane"
              onDragOver={(e) => onDragOver(e, track)}
              onDrop={(e) => onDrop(e, track)}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  onSelect(null)
                  seekFrom(e)
                }
              }}
            >
              {p.clips
                .filter((c) => c.trackId === track.id)
                .map((c) => {
                  const asset = isMedia(c) ? p.assets.find((a) => a.id === c.assetId) : undefined
                  const thumb = asset && asset.kind !== 'audio' ? thumbs.get(asset.id) : undefined
                  const label = c.type === 'text' ? c.text.split('\n')[0] || 'Text' : asset?.name ?? 'Missing media'
                  const tr = isMedia(c) && c.transitionIn.type !== 'none' ? c.transitionIn : null
                  const audioOnly = asset?.kind === 'audio' || track.kind === 'audio'
                  return (
                    <div
                      key={c.id}
                      className={`tl-clip ${c.type === 'text' ? 'tl-clip-text' : audioOnly ? 'tl-clip-audio' : 'tl-clip-video'} ${selectedId === c.id ? 'tl-clip-on' : ''} ${isMedia(c) && c.muted ? 'tl-clip-muted' : ''}`}
                      style={{ left: c.start * zoom, width: Math.max(6, c.duration * zoom), backgroundImage: thumb && !audioOnly ? `url(${thumb})` : undefined }}
                      onPointerDown={(e) => startDrag(e, c, 'move')}
                      role="button"
                      tabIndex={0}
                      aria-label={`${label}, ${formatDuration(c.start * 1000)} to ${formatDuration(clipEnd(c) * 1000)}`}
                      aria-pressed={selectedId === c.id}
                      onKeyDown={(e) => e.key === 'Enter' && onSelect(c.id)}
                    >
                      {tr && <span className="tl-trans" style={{ width: tr.duration * zoom }} title={`Transition in: ${transitionName(tr.type)}`} />}
                      {isMedia(c) && c.transitionOut && c.transitionOut.type !== 'none' && (
                        <span className="tl-trans tl-trans-out" style={{ width: Math.min(c.duration, c.transitionOut.duration) * zoom }} title={`Transition out: ${transitionName(c.transitionOut.type)}`} />
                      )}
                      {isMedia(c) && c.objects?.remove.length ? <span className="tl-badge" title="Objects removed">−{c.objects.remove.length}</span> : null}
                      <span className="tl-label">{label}</span>
                      <span className="tl-trim tl-trim-l" onPointerDown={(e) => startDrag(e, c, 'trim-l')} aria-hidden />
                      <span className="tl-trim tl-trim-r" onPointerDown={(e) => startDrag(e, c, 'trim-r')} aria-hidden />
                    </div>
                  )
                })}
              {drop?.rowId === track.id && drop.kind === 'text' && (
                <div className="tl-drop" style={{ left: drop.t * zoom, width: TEXT_DROP_LEN * zoom }}>
                  <span className="tl-drop-tag">Text at {formatDuration(drop.t * 1000)}</span>
                </div>
              )}
              {drop?.rowId === track.id && drop.kind === 'transition' && (
                <div className="tl-drop" style={{ left: drop.left * zoom, width: Math.max(28, drop.width * zoom) }}>
                  <span className="tl-drop-tag">{drop.edge === 'in' ? 'Transition in' : 'Transition out'}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="tl-playhead" style={{ left: HEAD_W + time * zoom }} aria-hidden />
      </div>
    </div>
    </div>
  )
}
