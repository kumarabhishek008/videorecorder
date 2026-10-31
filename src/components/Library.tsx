import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../hooks/useToast'
import { downloadBlob } from '../lib/files'
import { formatBytes, formatDate, formatDuration, safeFileName } from '../lib/format'
import type { OpenRecording } from '../lib/library'
import { extensionFor } from '../lib/recorder'
import { deleteRecording, listRecordings, loadMedia, type RecordingMeta } from '../lib/storage'
import { IconDownload, IconPlus, IconTrash, IconWave } from './Icons'

export function Library({ onOpen, onNew }: { onOpen: (r: OpenRecording) => void; onNew: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<RecordingMeta[] | null>(null)
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)

  const refresh = () => {
    listRecordings().then(setItems).catch(() => setItems([]))
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => {})
  }
  useEffect(refresh, [])

  const filtered = useMemo(() => (items ?? []).filter((r) => r.name.toLowerCase().includes(query.toLowerCase())), [items, query])

  const load = async (meta: RecordingMeta) => {
    const blob = await loadMedia(meta.id)
    if (!blob) toast(meta.onDisk ? 'Could not open the file on disk. It may have been moved, or access was denied.' : 'Recording data is missing.', 'error')
    return blob
  }

  const open = async (meta: RecordingMeta) => {
    const blob = await load(meta)
    if (blob) onOpen({ meta, blob, stored: true })
  }

  const download = async (meta: RecordingMeta) => {
    const blob = await load(meta)
    if (blob) downloadBlob(blob, `${safeFileName(meta.name)}.${extensionFor(meta.mimeType)}`)
  }

  const remove = async (meta: RecordingMeta) => {
    if (!window.confirm(`Delete "${meta.name}"?${meta.onDisk ? ' The file on disk is kept.' : ''}`)) return
    await deleteRecording(meta.id)
    refresh()
  }

  return (
    <div className="library">
      <div className="library-head">
        <h1 className="setup-title">Library</h1>
        <input type="search" placeholder="Search recordings" aria-label="Search recordings" value={query} onChange={(e) => setQuery(e.target.value)} />
        {usage && usage.quota > 0 && (
          <span className="muted small">
            {formatBytes(usage.usage)} used of {formatBytes(usage.quota)} browser storage
          </span>
        )}
      </div>

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="empty panel">
          <p>{items.length ? 'No recordings match your search.' : 'No recordings yet. They stay on this computer.'}</p>
          <button type="button" className="btn btn-primary" onClick={onNew}>
            <IconPlus /> New recording
          </button>
        </div>
      ) : (
        <ul className="grid">
          {filtered.map((r) => (
            <li key={r.id} className="card">
              <button type="button" className="card-open" onClick={() => void open(r)} aria-label={`Play ${r.name}`}>
                <Thumb meta={r} />
                <span className="card-duration">{formatDuration(r.durationMs)}</span>
              </button>
              <div className="card-body">
                <div className="card-name" title={r.name}>
                  {r.name}
                </div>
                <div className="muted small">
                  {formatDate(r.createdAt)} · {formatBytes(r.size)}
                  {r.onDisk && ' · on disk'}
                </div>
              </div>
              <div className="card-actions">
                <button type="button" className="icon-btn" onClick={() => void download(r)} aria-label={`Download ${r.name}`} title="Download">
                  <IconDownload />
                </button>
                <button type="button" className="icon-btn icon-danger" onClick={() => void remove(r)} aria-label={`Delete ${r.name}`} title="Delete">
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Thumb({ meta }: { meta: RecordingMeta }) {
  const url = useMemo(() => (meta.thumbnail ? URL.createObjectURL(meta.thumbnail) : null), [meta.thumbnail])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return <span className="thumb">{url ? <img src={url} alt="" /> : <IconWave width={36} height={36} />}</span>
}
