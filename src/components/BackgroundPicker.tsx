import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { PRESET_BACKGROUNDS } from '../lib/background'
import { addBackground, deleteBackground, listBackgrounds, type StoredBackground } from '../lib/backgroundStore'
import { IconPlus, IconTrash } from './Icons'

interface Props {
  value: string
  onChange: (id: string) => void
}

/** Grid of built-in backgrounds and your uploaded pictures, with an upload tile. */
export function BackgroundPicker({ value, onChange }: Props) {
  const [uploads, setUploads] = useState<(StoredBackground & { url: string })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    let urls: string[] = []
    listBackgrounds()
      .then((list) => {
        if (cancelled) return
        const withUrls = list.map((b) => ({ ...b, url: URL.createObjectURL(b.blob) }))
        urls = withUrls.map((b) => b.url)
        setUploads(withUrls)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    setError(null)
    let last: string | null = null
    for (const file of files) {
      try {
        const saved = await addBackground(file)
        setUploads((u) => [...u, { ...saved, url: URL.createObjectURL(saved.blob) }])
        last = saved.id
      } catch {
        setError(`“${file.name}” isn't a picture this browser can open.`)
      }
    }
    setBusy(false)
    if (last) onChange(last)
  }

  const remove = async (b: StoredBackground & { url: string }) => {
    await deleteBackground(b.id)
    URL.revokeObjectURL(b.url)
    setUploads((u) => u.filter((x) => x.id !== b.id))
    if (value === b.id) onChange(PRESET_BACKGROUNDS[0].id)
  }

  return (
    <div className="field">
      <span className="label" id="bg-pick-label">
        Picture
      </span>
      <div className="bg-grid" role="radiogroup" aria-labelledby="bg-pick-label">
        {PRESET_BACKGROUNDS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value === p.id}
            aria-label={p.name}
            title={p.name}
            className={`bg-tile ${value === p.id ? 'bg-tile-on' : ''}`}
            style={{ background: `linear-gradient(135deg, ${p.stops.join(', ')})` }}
            onClick={() => onChange(p.id)}
          />
        ))}
        {uploads.map((b) => (
          <div key={b.id} className="bg-tile-wrap">
            <button
              type="button"
              role="radio"
              aria-checked={value === b.id}
              aria-label={b.name}
              title={b.name}
              className={`bg-tile ${value === b.id ? 'bg-tile-on' : ''}`}
              style={{ backgroundImage: `url(${b.url})` }}
              onClick={() => onChange(b.id)}
            />
            <button type="button" className="bg-del" aria-label={`Delete ${b.name}`} title="Delete picture" onClick={() => void remove(b)}>
              <IconTrash width={12} height={12} />
            </button>
          </div>
        ))}
        <button type="button" className="bg-tile bg-add" onClick={() => input.current?.click()} disabled={busy} aria-label="Upload pictures" title="Upload pictures">
          <IconPlus width={18} height={18} />
        </button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void upload(e)} />
      </div>
      <span className="muted small">{busy ? 'Adding pictures…' : 'Upload your own pictures. They stay on this computer.'}</span>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
