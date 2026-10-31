import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../hooks/useToast'
import { canPickFiles, canPickFolders, downloadBlob, ensureWriteAccess, getSaveFolder, pickSaveFolder, saveBlobAs, saveToFolder } from '../lib/files'
import { formatBytes, formatDate, formatDuration, safeFileName } from '../lib/format'
import { persistRecording, type OpenRecording } from '../lib/library'
import { extensionFor } from '../lib/recorder'
import type { Settings } from '../lib/settings'
import { deleteRecording, updateRecording } from '../lib/storage'
import { captureFrame } from '../lib/thumbnail'
import { trimRecording, type TrimJob } from '../lib/trim'
import { IconDownload, IconFolder, IconImage, IconLibrary, IconPlus, IconSave, IconScissors, IconTrash } from './Icons'

interface Props {
  recording: OpenRecording
  settings: Settings
  onNew: () => void
  onLibrary: () => void
  onDeleted: () => void
  onOpen: (r: OpenRecording) => void
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function Review({ recording, settings, onNew, onLibrary, onDeleted, onOpen }: Props) {
  const toast = useToast()
  const { meta, blob, stored } = recording
  const isAudio = meta.mimeType.startsWith('audio')
  const ext = extensionFor(meta.mimeType)
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [name, setName] = useState(meta.name)
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const durationSec = meta.durationMs / 1000
  const [trimOpen, setTrimOpen] = useState(false)
  const [range, setRange] = useState<[number, number]>([0, durationSec])
  const [trimProgress, setTrimProgress] = useState<number | null>(null)
  const trimJob = useRef<TrimJob | null>(null)

  useEffect(() => {
    setName(meta.name)
    setRange([0, meta.durationMs / 1000])
    setTrimOpen(false)
  }, [meta.id, meta.name, meta.durationMs])

  useEffect(() => {
    if (player.current) player.current.playbackRate = speed
  }, [speed, url])

  useEffect(() => () => trimJob.current?.cancel(), [])

  const fileName = `${safeFileName(name)}.${ext}`

  const rename = async () => {
    const n = name.trim() || meta.name
    setName(n)
    if (n !== meta.name && stored) await updateRecording(meta.id, { name: n })
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toast(`${label} failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveAs = () =>
    run('Save', async () => {
      if (await saveBlobAs(blob, fileName, ext)) toast(canPickFiles ? 'Saved to your computer.' : 'Download started.', 'success')
    })

  const saveFolder = () =>
    run('Save to folder', async () => {
      let dir = await getSaveFolder()
      if (!dir || !(await ensureWriteAccess(dir, true))) dir = (await pickSaveFolder()) ?? undefined
      if (!dir) return
      const saved = await saveToFolder(dir, blob, safeFileName(name), ext)
      toast(`Saved to ${dir.name}/${saved}`, 'success')
    })

  const screenshot = () =>
    run('Screenshot', async () => {
      const v = player.current
      if (!v) return
      const png = await captureFrame(v)
      if (png) await saveBlobAs(png, `${safeFileName(name)} ${formatDuration(v.currentTime * 1000).replace(/:/g, '-')}.png`, 'png')
    })

  const remove = async () => {
    if (!window.confirm(`Delete "${name}" from the library?${meta.onDisk ? ' The file on disk is kept.' : ''}`)) return
    if (stored) await deleteRecording(meta.id)
    onDeleted()
  }

  const startTrim = () => {
    const [a, b] = range
    if (b - a < 0.5) return toast('Pick a range of at least half a second.', 'error')
    setTrimProgress(0)
    const job = trimRecording(blob, a, b, settings.format, isAudio, setTrimProgress)
    trimJob.current = job
    job.promise
      .then(async (out) => {
        const r = await persistRecording(out, `${name} (trimmed)`, meta.mode, settings.keepInLibrary)
        toast('Trimmed copy created.', 'success')
        onOpen(r)
      })
      .catch((e) => toast(`Trim failed: ${(e as Error).message}`, 'error'))
      .finally(() => {
        trimJob.current = null
        setTrimProgress(null)
      })
  }

  const cancelTrim = () => {
    trimJob.current?.cancel()
    trimJob.current = null
    setTrimProgress(null)
  }

  const seek = (t: number) => {
    if (player.current) player.current.currentTime = t
  }

  return (
    <div className="review">
      <section className="review-player" aria-label="Playback">
        {isAudio ? (
          <div className="audio-player">
            <audio ref={player} src={url} controls autoPlay />
          </div>
        ) : (
          <video ref={player} src={url} controls autoPlay playsInline className="player" />
        )}
        <div className="row wrap gap-s player-tools">
          <label className="row gap-s small">
            <span className="muted">Speed</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
              {SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          {!isAudio && (
            <button type="button" className="btn btn-small btn-ghost" onClick={screenshot} disabled={!!busy}>
              <IconImage width={16} height={16} /> Save frame as PNG
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setTrimOpen(!trimOpen)} aria-expanded={trimOpen}>
            <IconScissors width={16} height={16} /> Trim
          </button>
          {!isAudio && document.pictureInPictureEnabled && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => void player.current?.requestPictureInPicture().catch(() => {})}>
              Picture-in-picture
            </button>
          )}
        </div>

        {trimOpen && (
          <div className="trim panel">
            <div className="trim-track">
              <div className="trim-sel" style={{ left: `${(range[0] / durationSec) * 100}%`, right: `${100 - (range[1] / durationSec) * 100}%` }} />
              <input
                type="range"
                aria-label="Trim start"
                min={0}
                max={durationSec}
                step={0.1}
                value={range[0]}
                onChange={(e) => {
                  const v = Math.min(Number(e.target.value), range[1] - 0.5)
                  setRange([v, range[1]])
                  seek(v)
                }}
              />
              <input
                type="range"
                aria-label="Trim end"
                min={0}
                max={durationSec}
                step={0.1}
                value={range[1]}
                onChange={(e) => {
                  const v = Math.max(Number(e.target.value), range[0] + 0.5)
                  setRange([range[0], v])
                  seek(v)
                }}
              />
            </div>
            <div className="row wrap gap-s">
              <span className="small">
                {formatDuration(range[0] * 1000)} → {formatDuration(range[1] * 1000)} <span className="muted">({formatDuration((range[1] - range[0]) * 1000)})</span>
              </span>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => player.current && setRange([Math.min(player.current.currentTime, range[1] - 0.5), range[1]])}>
                Set start to playhead
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => player.current && setRange([range[0], Math.max(player.current.currentTime, range[0] + 0.5)])}>
                Set end to playhead
              </button>
              {trimProgress === null ? (
                <button type="button" className="btn btn-small" onClick={startTrim}>
                  Create trimmed copy
                </button>
              ) : (
                <>
                  <progress value={trimProgress} max={1} aria-label="Trimming progress" />
                  <button type="button" className="btn btn-small btn-ghost" onClick={cancelTrim}>
                    Cancel
                  </button>
                </>
              )}
            </div>
            <p className="muted small">Trimming re-records the selected range in real time, so it takes as long as the clip. The original is kept.</p>
          </div>
        )}
      </section>

      <aside className="review-side panel">
        <label className="field">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        <dl className="facts">
          <dt>Length</dt>
          <dd>{formatDuration(meta.durationMs)}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(blob.size)}</dd>
          <dt>Format</dt>
          <dd>{meta.mimeType.split(';')[0]}</dd>
          {meta.width && (
            <>
              <dt>Resolution</dt>
              <dd>
                {meta.width}×{meta.height}
              </dd>
            </>
          )}
          <dt>Recorded</dt>
          <dd>{formatDate(meta.createdAt)}</dd>
          {meta.onDisk && (
            <>
              <dt>File</dt>
              <dd>{meta.diskName}</dd>
            </>
          )}
        </dl>

        <div className="stack">
          <button type="button" className="btn btn-primary" onClick={saveAs} disabled={!!busy}>
            <IconSave /> {canPickFiles ? 'Save to computer…' : 'Download'}
          </button>
          {canPickFolders && (
            <button type="button" className="btn" onClick={saveFolder} disabled={!!busy}>
              <IconFolder /> Save to folder
            </button>
          )}
          {canPickFiles && (
            <button type="button" className="btn btn-ghost" onClick={() => downloadBlob(blob, fileName)}>
              <IconDownload /> Download
            </button>
          )}
        </div>
        {!stored && <p className="muted small">Not kept in the browser library (turned off in settings). Save it before leaving.</p>}

        <div className="stack">
          <button type="button" className="btn btn-ghost" onClick={onNew}>
            <IconPlus /> New recording
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLibrary}>
            <IconLibrary /> Library
          </button>
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => void remove()}>
            <IconTrash /> Delete
          </button>
        </div>
      </aside>
    </div>
  )
}
