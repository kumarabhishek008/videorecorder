import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as RPointerEvent } from 'react'
import { EditorEngine } from '../../editor/engine'
import { LOOKS, parseCube, registerLut } from '../../editor/luts'
import { scanClip, type ScanJob } from '../../editor/objectScan'
import { addAsset, addClipAt, addText, addTrack, deleteClips, detachAudio, rippleDelete, splitClip, trackEnd, updateClip } from '../../editor/ops'
import { deleteProject, getBlob, kindOf, listProjects, newProject, probeMedia, putBlob, saveProject } from '../../editor/store'
import { TEXT_DESIGNS } from '../../editor/text'
import { TRANSITIONS } from '../../editor/transitions'
import { DND_TEXT, DND_TRANSITION } from '../../editor/dnd'
import { LookPreview, TextPreview } from './Previews'
import { clipEnd, isMedia, projectDuration, type Asset, type MediaClip, type Project } from '../../editor/types'
import { useHistory } from '../../editor/useHistory'
import { useToast } from '../../hooks/useToast'
import { formatDuration } from '../../lib/format'
import { downloadBlob } from '../../lib/files'
import { persistRecording, type OpenRecording } from '../../lib/library'
import type { Settings } from '../../lib/settings'
import { listRecordings, loadMedia, newId, type RecordingMeta } from '../../lib/storage'
import { makeThumbnail } from '../../lib/thumbnail'
import { IconDownload, IconFolder, IconLayers, IconLibrary, IconPalette, IconPause, IconPlay, IconPlus, IconRedo, IconScissors, IconSkipEnd, IconSkipStart, IconSplit, IconText, IconTransition, IconTrash, IconUndo, IconWave } from '../Icons'
import { Inspector } from './Inspector'
import { Timeline } from './Timeline'
import { useSidePanels } from './useSidePanels'

interface Props {
  settings: Settings
  /** A recording sent from the review screen, added to the timeline once. */
  incoming: OpenRecording | null
  onConsumed: () => void
  onOpen: (r: OpenRecording) => void
}

type SideTab = 'media' | 'text' | 'transitions' | 'looks'

const CANVAS_SIZES: [string, number, number][] = [
  ['1080p landscape', 1920, 1080],
  ['720p landscape', 1280, 720],
  ['4K landscape', 3840, 2160],
  ['Vertical 9:16', 1080, 1920],
  ['Square 1:1', 1080, 1080],
  ['Portrait 4:5', 1080, 1350],
]

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

export function Editor({ settings, incoming, onConsumed, onOpen }: Props) {
  const toast = useToast()
  const { project, apply, reset, undo, redo, canUndo, canRedo } = useHistory(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(40)
  const [side, setSide] = useState<SideTab>('media')
  const [importing, setImporting] = useState(false)
  const [library, setLibrary] = useState<RecordingMeta[] | null>(null)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [lastExport, setLastExport] = useState<OpenRecording | null>(null)
  const [scan, setScan] = useState<{ clipId: string; progress: number } | null>(null)
  const exportJob = useRef<{ cancel: () => void } | null>(null)
  const scanJob = useRef<ScanJob | null>(null)
  const engine = useMemo(() => new EditorEngine(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const lutInput = useRef<HTMLInputElement>(null)
  const urlsRef = useRef(urls)
  urlsRef.current = urls

  useEffect(() => {
    engine.onTime = setTime
    engine.onEnded = () => setPlaying(false)
    return () => {
      engine.destroy()
      engine.canvas.remove()
    }
  }, [engine])
  const bodyRef = useSidePanels(project ? project.width / project.height : 16 / 9)
  // The preview canvas moves into the stage once it exists (after the project has loaded).
  const host = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && engine.canvas.parentElement !== el) el.appendChild(engine.canvas)
    },
    [engine],
  )

  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const openProject = useCallback(
    async (p: Project) => {
      engine.pause()
      setPlaying(false)
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      const next = new Map<string, string>()
      const nextThumbs = new Map<string, string>()
      for (const a of p.assets) {
        const blob = await getBlob(a.id)
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        next.set(a.id, url)
        if (a.kind === 'image') nextThumbs.set(a.id, url)
        else if (a.kind === 'video')
          void makeThumbnail(blob, 240).then((t) => t.thumbnail && setThumbs((m) => new Map(m).set(a.id, URL.createObjectURL(t.thumbnail!))))
      }
      for (const l of p.luts) {
        const blob = await getBlob(l.id)
        if (blob) {
          try {
            registerLut(l.id, parseCube(await blob.text()))
          } catch {
            /* a broken LUT just isn't applied */
          }
        }
      }
      setUrls(next)
      setThumbs(nextThumbs)
      setSelectedId(null)
      setTime(0)
      reset(p)
    },
    [engine, reset],
  )

  useEffect(() => {
    void listProjects().then(async (list) => {
      setProjects(list)
      await openProject(list[0] ?? newProject())
    })
  }, [openProject])

  // Save a moment after each change.
  useEffect(() => {
    if (!project) return
    const id = setTimeout(() => {
      void saveProject(project).then(() => listProjects().then(setProjects))
    }, 800)
    return () => clearTimeout(id)
  }, [project])

  useEffect(() => {
    if (project) engine.setProject(project, urls)
  }, [engine, project, urls])

  const importBlob = useCallback(
    async (blob: Blob, name: string, type: string) => {
      const kind = kindOf(type) ?? kindOf(blob.type)
      if (!kind) throw new Error(`"${name}" isn't a video, audio or image file.`)
      const meta = await probeMedia(blob, kind)
      const id = newId()
      await putBlob(id, blob)
      const asset: Asset = { id, name, kind, mimeType: type || blob.type, ...meta }
      const url = URL.createObjectURL(blob)
      setUrls((m) => new Map(m).set(id, url))
      if (kind === 'image') setThumbs((m) => new Map(m).set(id, url))
      if (kind === 'video') void makeThumbnail(blob, 240).then((t) => t.thumbnail && setThumbs((m) => new Map(m).set(id, URL.createObjectURL(t.thumbnail!))))
      const clipId = newId()
      apply((p) => addAsset(p, asset, true, clipId).project)
      setSelectedId(clipId)
    },
    [apply],
  )

  // A recording sent from the review screen.
  useEffect(() => {
    if (!incoming || !project) return
    onConsumed()
    void importBlob(incoming.blob, incoming.meta.name, incoming.meta.mimeType.split(';')[0])
      .then(() => toast(`Added "${incoming.meta.name}" to the timeline.`, 'success'))
      .catch((e) => toast((e as Error).message, 'error'))
  }, [incoming, project, importBlob, onConsumed, toast])

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setImporting(true)
    for (const f of files) {
      try {
        await importBlob(f, f.name.replace(/\.[^.]+$/, ''), f.type)
      } catch (err) {
        toast((err as Error).message, 'error')
      }
    }
    setImporting(false)
  }

  const addFromLibrary = async (meta: RecordingMeta) => {
    setLibrary(null)
    setImporting(true)
    try {
      const blob = await loadMedia(meta.id)
      if (!blob) throw new Error('Could not open that recording.')
      await importBlob(blob, meta.name, meta.mimeType.split(';')[0])
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const onLut = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const lut = parseCube(text)
      const id = `lut:${newId()}`
      registerLut(id, lut)
      await putBlob(id, new Blob([text], { type: 'text/plain' }))
      const name = file.name.replace(/\.cube$/i, '')
      apply((p) => {
        let next = { ...p, luts: [...p.luts, { id, name }] }
        const sel = p.clips.find((c) => c.id === selectedId)
        if (sel && isMedia(sel)) next = updateClip(next, sel.id, { lut: id })
        return next
      })
      toast(`LUT "${name}" imported.`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const togglePlay = useCallback(() => {
    if (engine.playing) {
      engine.pause()
      setPlaying(false)
    } else {
      engine.play()
      setPlaying(true)
    }
  }, [engine])

  const seek = useCallback(
    (t: number) => {
      setTime(t)
      void engine.seek(t)
    },
    [engine],
  )

  const selected = project?.clips.find((c) => c.id === selectedId) ?? null

  const split = useCallback(() => {
    if (!project) return
    // Split the selected clip, or every clip under the playhead if none is selected.
    const targets = selected && time > selected.start && time < clipEnd(selected) ? [selected] : project.clips.filter((c) => time > c.start && time < clipEnd(c))
    if (!targets.length) return toast('Move the playhead over a clip to split it.', 'info')
    const rightIds = targets.map(() => newId())
    apply((p) => targets.reduce((acc, c, i) => splitClip(acc, c.id, time, rightIds[i]).project, p))
    setSelectedId(rightIds[0])
  }, [project, selected, time, apply, toast])

  const remove = useCallback(
    (ripple: boolean) => {
      if (!selectedId) return
      apply((p) => (ripple ? rippleDelete(p, selectedId) : deleteClips(p, [selectedId])))
      setSelectedId(null)
    },
    [selectedId, apply],
  )

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        return redo()
      }
      if (mod) return
      const fps = project?.fps ?? 30
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 's':
        case 'S':
          split()
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          remove(e.shiftKey)
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(Math.max(0, time - (e.shiftKey ? 1 : 1 / fps)))
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(time + (e.shiftKey ? 1 : 1 / fps))
          break
        case 'Escape':
          setSelectedId(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project, time, togglePlay, split, remove, seek, undo, redo])

  // Dragging on the preview moves the selected clip or text.
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; id: string } | null>(null)
  const onStageDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!selected || e.button !== 0) return
    if (!('x' in selected)) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    dragRef.current = { x: e.clientX, y: e.clientY, cx: selected.x, cy: selected.y, id: selected.id }
  }
  const onStageMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const r = engine.canvas.getBoundingClientRect()
    const x = d.cx + (e.clientX - d.x) / r.width
    const y = d.cy + (e.clientY - d.y) / r.height
    apply((p) => updateClip(p, d.id, { x, y }), `move:${d.id}`)
  }
  const onStageUp = () => {
    dragRef.current = null
  }

  const runScan = (clip: MediaClip) => {
    const url = urls.get(clip.assetId)
    if (!url) return
    setScan({ clipId: clip.id, progress: 0 })
    const job = scanClip(url, clip, (f) => setScan({ clipId: clip.id, progress: f }))
    scanJob.current = job
    job.promise
      .then(({ objects, plate }) => {
        engine.plates.set(clip.id, plate)
        apply((p) => updateClip(p, clip.id, { objects }))
        toast(objects.labels.length ? `Found ${objects.labels.map((l) => l.label).join(', ')}.` : 'No objects found in this clip.', 'success')
      })
      .catch((e) => (e as Error).message !== 'cancelled' && toast(`Object scan failed: ${(e as Error).message}`, 'error'))
      .finally(() => {
        scanJob.current = null
        setScan(null)
      })
  }

  const startExport = () => {
    if (!project || projectDuration(project) <= 0) return toast('Add something to the timeline first.', 'info')
    engine.pause()
    setPlaying(false)
    const out = new EditorEngine()
    out.setProject(project, urls)
    for (const [id, plate] of engine.plates) out.plates.set(id, plate)
    setExportProgress(0)
    const job = out.export(settings.format, setExportProgress)
    exportJob.current = {
      cancel: () => {
        job.cancel()
        out.destroy()
      },
    }
    job.promise
      .then(async (res) => {
        out.destroy()
        // Download straight away and stay in the editor; a copy also goes to the library.
        const ext = res.mimeType.includes('mp4') ? 'mp4' : 'webm'
        const name = (project.name || 'Edit').replace(/[\\/:*?"<>|]+/g, '-')
        downloadBlob(res.blob, `${name}.${ext}`)
        const r = await persistRecording(res, `${project.name} (edit)`, 'screen', settings.keepInLibrary)
        setLastExport(r)
        toast(`Downloaded ${name}.${ext}${r.stored ? ' — a copy is in your library too.' : '.'}`, 'success')
      })
      .catch((e) => toast(`Export failed: ${(e as Error).message}`, 'error'))
      .finally(() => {
        exportJob.current = null
        setExportProgress(null)
      })
  }

  if (!project) {
    return (
      <div className="saving" role="status">
        <div className="spinner" aria-hidden /> Opening editor…
      </div>
    )
  }

  const duration = projectDuration(project)
  const selectedMedia = selected && isMedia(selected) ? selected : null
  const needClip = () => toast('Select a video or picture clip on the timeline first.', 'info')
  const sizeKey = `${project.width}x${project.height}`

  return (
    <div className="editor">
      <div className="ed-top">
        <input className="ed-name" value={project.name} onChange={(e) => apply((p) => ({ ...p, name: e.target.value }), 'name')} aria-label="Project name" />
        <select
          className="ed-projects"
          aria-label="Open project"
          value={project.id}
          onChange={(e) => {
            const p = projects.find((x) => x.id === e.target.value)
            if (p) void saveProject(project).then(() => openProject(p))
          }}
        >
          {[project, ...projects.filter((p) => p.id !== project.id)].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void saveProject(project).then(() => openProject(newProject()))}>
          <IconPlus /> New
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => {
            if (!window.confirm(`Delete the project "${project.name}"? Recordings in your library are not affected.`)) return
            void deleteProject(project).then(async () => {
              const list = (await listProjects()).filter((p) => p.id !== project.id)
              setProjects(list)
              await openProject(list[0] ?? newProject())
            })
          }}
        >
          <IconTrash /> Delete
        </button>
        <span className="ed-spacer" />
        <select
          className="ed-size"
          aria-label="Canvas size"
          value={sizeKey}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number)
            apply((p) => ({ ...p, width: w, height: h }))
          }}
        >
          {!CANVAS_SIZES.some(([, w, h]) => `${w}x${h}` === sizeKey) && <option value={sizeKey}>Source size ({project.width}×{project.height})</option>}
          {CANVAS_SIZES.map(([label, w, h]) => (
            <option key={label} value={`${w}x${h}`}>
              {label}
            </option>
          ))}
        </select>
        {exportProgress === null ? (
          <>
            {lastExport && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => onOpen(lastExport)} title="Watch the last export">
                <IconPlay /> Last export
              </button>
            )}
            <button type="button" className="btn btn-primary btn-small" onClick={startExport} title="Render the video and download it">
              <IconDownload /> Export &amp; download
            </button>
          </>
        ) : (
          <span className="row gap-s">
            <progress value={exportProgress} max={1} aria-label="Export progress" />
            <span className="small">{Math.round(exportProgress * 100)}%</span>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => exportJob.current?.cancel()}>
              Cancel
            </button>
          </span>
        )}
      </div>

      <div className="ed-body" ref={bodyRef}>
        <aside className="ed-side">
          <div className="ed-side-tabs" role="tablist">
            {(
              [
                ['media', 'Media', IconFolder],
                ['text', 'Text', IconText],
                ['transitions', 'Transitions', IconTransition],
                ['looks', 'Looks', IconPalette],
              ] as const
            ).map(([t, label, Icon]) => (
              <button key={t} type="button" role="tab" aria-selected={side === t} className={side === t ? 'ed-tab-on' : ''} onClick={() => setSide(t)}>
                <Icon width={16} height={16} />
                {label}
              </button>
            ))}
          </div>

          <div className="ed-side-body">
            {side === 'media' && (
              <>
                <div className="row gap-s wrap">
                  <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()} disabled={importing}>
                    <IconPlus /> Import files
                  </button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => void listRecordings().then(setLibrary)}>
                    <IconLibrary /> From library
                  </button>
                  <input ref={fileInput} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={(e) => void onFiles(e)} />
                </div>
                {importing && <p className="muted small">Adding…</p>}
                {library && (
                  <div className="ed-lib">
                    <div className="row">
                      <strong className="small">Your recordings</strong>
                      <button type="button" className="link-btn" onClick={() => setLibrary(null)}>
                        Close
                      </button>
                    </div>
                    {library.length === 0 && <p className="muted small">No recordings yet.</p>}
                    {library.map((r) => (
                      <button key={r.id} type="button" className="ed-lib-item" onClick={() => void addFromLibrary(r)}>
                        <span className="truncate">{r.name}</span>
                        <span className="muted small">{formatDuration(r.durationMs)}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="ed-assets">
                  {project.assets.length === 0 && !library && <p className="muted small">Import videos, music, voice-overs or pictures. They stay on this computer.</p>}
                  {project.assets.map((a) => (
                    <div key={a.id} className="ed-asset">
                      <div className={`ed-asset-thumb ed-asset-${a.kind}`} style={{ backgroundImage: thumbs.get(a.id) ? `url(${thumbs.get(a.id)})` : undefined }}>
                        {a.kind === 'audio' && <IconWave />}
                        <span className="ed-asset-len">{a.kind === 'image' ? 'Image' : formatDuration(a.duration * 1000)}</span>
                      </div>
                      <span className="truncate small" title={a.name}>
                        {a.name}
                      </span>
                      <button
                        type="button"
                        className="btn btn-small btn-ghost"
                        onClick={() => {
                          const clipId = newId()
                          apply((p) => {
                            const kind = a.kind === 'audio' ? 'audio' : 'video'
                            const tracks = p.tracks.filter((t) => t.kind === kind)
                            const track = kind === 'video' ? tracks[tracks.length - 1] : tracks[0]
                            return track ? addClipAt(p, a, track.id, trackEnd(p, track.id), clipId).project : p
                          })
                          setSelectedId(clipId)
                        }}
                      >
                        <IconPlus /> Add
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {side === 'text' && (
              <>
                <p className="muted small">Drag a design onto the timeline (it snaps to clip ends), or click to add it at the playhead.</p>
                <div className="design-grid">
                  {TEXT_DESIGNS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`design design-${d.id}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_TEXT, d.id)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      title="Drag onto the timeline, or click to add at the playhead"
                      onClick={() => {
                        const clipId = newId()
                        apply((p) => addText(p, d.id, time, clipId).project)
                        setSelectedId(clipId)
                      }}
                    >
                      <TextPreview designId={d.id} />
                      <span className="design-name">{d.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {side === 'transitions' && (
              <>
                <p className="muted small">Drag onto a clip: drop on its start for how it enters, on its end for how it leaves. Or select a clip and click.</p>
                <div className="trans-grid">
                  {TRANSITIONS.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      className={`trans ${selectedMedia?.transitionIn.type === t.type ? 'trans-on' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_TRANSITION, t.type)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      title="Drag onto a clip: its first half sets how it enters, the second half how it leaves"
                      onClick={() => (selectedMedia ? apply((p) => updateClip(p, selectedMedia.id, { transitionIn: { ...selectedMedia.transitionIn, type: t.type } })) : needClip())}
                    >
                      <span className={`trans-icon trans-${t.type}`} aria-hidden>
                        <span />
                      </span>
                      {t.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {side === 'looks' && (
              <>
                <div className="row">
                  <p className="muted small">Color looks for the selected clip.</p>
                  <button type="button" className="link-btn" onClick={() => lutInput.current?.click()}>
                    Import .cube
                  </button>
                </div>
                <div className="look-grid">
                  {LOOKS.map((l) => (
                    <button key={l.id} type="button" className={`look ${selectedMedia?.lut === l.id ? 'look-on' : ''}`} onClick={() => (selectedMedia ? apply((p) => updateClip(p, selectedMedia.id, { lut: selectedMedia.lut === l.id ? null : l.id })) : needClip())}>
                      <LookPreview lookId={l.id} />
                      {l.name}
                    </button>
                  ))}
                  {project.luts.map((l) => (
                    <button key={l.id} type="button" className={`look ${selectedMedia?.lut === l.id ? 'look-on' : ''}`} onClick={() => (selectedMedia ? apply((p) => updateClip(p, selectedMedia.id, { lut: l.id })) : needClip())}>
                      <span className="look-sw look-sw-file">.cube</span>
                      {l.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <input ref={lutInput} type="file" accept=".cube" hidden onChange={(e) => void onLut(e)} />
          </div>
        </aside>

        <section className="ed-center" aria-label="Preview">
          <div className="ed-stage" onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
            <div ref={host} className="ed-canvas" style={{ aspectRatio: `${project.width} / ${project.height}`, ['--ar' as string]: project.width / project.height }} />
            {project.clips.length === 0 && (
              <div className="ed-empty">
                <IconLayers width={32} height={32} />
                <p>Import a video, or send a recording here with “Edit” on its page.</p>
              </div>
            )}
          </div>
          <div className="ed-transport">
            <button type="button" className="icon-btn" onClick={() => seek(0)} aria-label="Go to start" title="Start">
              <IconSkipStart />
            </button>
            <button type="button" className="icon-btn ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="icon-btn" onClick={() => seek(duration)} aria-label="Go to end" title="End">
              <IconSkipEnd />
            </button>
            <span className="timer">
              {formatDuration(time * 1000)} <span className="muted">/ {formatDuration(duration * 1000)}</span>
            </span>
          </div>
        </section>

        <aside className="ed-inspector" aria-label="Clip settings">
          {selected ? (
            <Inspector project={project} clipId={selected.id} apply={apply} onImportLut={() => lutInput.current?.click()} onScan={runScan} scan={scan} onCancelScan={() => scanJob.current?.cancel()} />
          ) : (
            <div className="ins-empty muted small">
              <p>Select a clip on the timeline to adjust color, looks, transitions, objects, text and sound.</p>
              <p>
                <kbd>Space</kbd> play · <kbd>S</kbd> split · <kbd>Delete</kbd> remove · <kbd>⇧ Delete</kbd> remove & close gap · <kbd>⌘Z</kbd> undo · <kbd>←</kbd>
                <kbd>→</kbd> frame
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="ed-tools" role="toolbar" aria-label="Timeline tools">
        <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
          <IconUndo />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
          <IconRedo />
        </button>
        <span className="divider" aria-hidden />
        <button type="button" className="btn btn-small btn-ghost" onClick={split} title="Split at playhead (S)">
          <IconSplit /> Split
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => remove(false)} disabled={!selected} title="Delete (Delete)">
          <IconTrash /> Delete
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => remove(true)} disabled={!selected} title="Delete and close the gap (Shift+Delete)">
          <IconScissors /> Ripple delete
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => selectedMedia && apply((p) => detachAudio(p, selectedMedia.id))}
          disabled={!selectedMedia || project.assets.find((a) => a.id === selectedMedia.assetId)?.kind !== 'video' || project.tracks.find((t) => t.id === selectedMedia.trackId)?.kind === 'audio'}
          title="Move this clip's sound to an audio track"
        >
          <IconWave /> Detach audio
        </button>
        <span className="divider" aria-hidden />
        <button type="button" className="btn btn-small btn-ghost" onClick={() => apply((p) => addTrack(p, 'video'))}>
          <IconPlus /> Video track
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => apply((p) => addTrack(p, 'audio'))}>
          <IconPlus /> Audio track
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => apply((p) => addTrack(p, 'text'))}>
          <IconPlus /> Text track
        </button>
        <span className="ed-spacer" />
        <label className="ed-zoom">
          <span className="muted small">Zoom</span>
          <input type="range" min={8} max={240} step={1} value={zoom} style={{ ["--p" as string]: `${((zoom - 8) / 232) * 100}%` }} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" />
        </label>
      </div>

      <Timeline project={project} time={time} zoom={zoom} selectedId={selectedId} thumbs={thumbs} onSelect={setSelectedId} onSeek={seek} apply={apply} />
    </div>
  )
}
