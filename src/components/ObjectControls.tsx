import type { ObjectSummary } from '../lib/objects'
import { labelColor } from '../lib/objects'
import type { Settings } from '../lib/settings'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => void
  list: ObjectSummary[]
  status: 'off' | 'loading' | 'ready' | 'error'
}

/** What the camera sees right now, with Keep / Remove for each kind of object. */
export function ObjectControls({ settings: s, update, list, status }: Props) {
  const removed = new Set(s.removedObjects)
  // Kinds you removed stay listed even while out of view, so you can bring them back.
  const labels = [...new Set([...list.map((o) => o.label), ...s.removedObjects])].sort()
  const count = (label: string) => list.find((o) => o.label === label)?.count ?? 0
  const toggle = (label: string) => update({ removedObjects: removed.has(label) ? s.removedObjects.filter((l) => l !== label) : [...s.removedObjects, label] })

  return (
    <div className="objects">
      <p className="muted small" role="status">
        {status === 'off' && 'Waiting for the camera…'}
        {status === 'loading' &&'Loading ml5.js object detection… (first time takes a few seconds)'}
        {status === 'error' && 'Could not load object detection. Check your internet connection, then turn it off and on again.'}
        {status === 'ready' && (labels.length ? 'Tap an object to remove it from the video, tap again to keep it.' : 'Looking for objects… hold something up to the camera.')}
      </p>
      {labels.length > 0 && (
        <div className="object-list">
          {labels.map((label) => {
            const off = removed.has(label)
            const n = count(label)
            return (
              <button
                key={label}
                type="button"
                className={`object-chip ${off ? 'object-chip-off' : ''}`}
                aria-pressed={off}
                onClick={() => toggle(label)}
                title={off ? `Keep ${label} in the video` : `Remove ${label} from the video`}
              >
                <span className="object-dot" style={{ background: labelColor(label) }} aria-hidden />
                <span className="object-name">{label}</span>
                {n > 0 && <span className="object-count">{n}</span>}
                <span className="object-action">{off ? 'Removed' : 'Keep'}</span>
              </button>
            )
          })}
        </div>
      )}
      <label className="toggle toggle-compact">
        <input type="checkbox" role="switch" checked={s.showObjectLabels} onChange={(e) => update({ showObjectLabels: e.target.checked })} />
        <span className="switch" aria-hidden />
        <span className="toggle-text">
          <span>Show labels in the video</span>
        </span>
      </label>
    </div>
  )
}
