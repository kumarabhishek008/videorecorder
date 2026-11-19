import { useState, type ReactNode } from 'react'
import { LOOKS } from '../../editor/luts'
import { previousClip, updateClip } from '../../editor/ops'
import { BOXED_DESIGNS, DEFAULT_BG_OPACITY, FONTS, TEXT_ANIMS, TEXT_DESIGNS } from '../../editor/text'
import { LookPreview, TextPreview } from './Previews'
import { TRANSITIONS } from '../../editor/transitions'
import { isMedia, neutralColor, type ColorAdjust, type MediaClip, type Project, type TextClip } from '../../editor/types'
import { labelColor } from '../../lib/objects'
import { formatDuration } from '../../lib/format'

interface Props {
  project: Project
  clipId: string
  apply: (fn: (p: Project) => Project, key?: string) => void
  onImportLut: () => void
  onScan: (clip: MediaClip) => void
  scan: { clipId: string; progress: number } | null
  onCancelScan: () => void
}

type Tab = 'adjust' | 'look' | 'transition' | 'objects' | 'layout' | 'audio'

const COLOR_SLIDERS: { key: keyof ColorAdjust; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.01 },
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  { key: 'fade', label: 'Fade', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 1, step: 0.01 },
]

export function Range({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="ins-range">
      <span className="ins-range-top">
        <span>{label}</span>
        <span className="muted" onDoubleClick={() => onChange(0)}>
          {format ? format(value) : value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ ['--p' as string]: `${((value - min) / (max - min || 1)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(min < 0 ? 0 : min)} />
    </label>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ins-section">
      <div className="ins-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Inspector({ project: p, clipId, apply, onImportLut, onScan, scan, onCancelScan }: Props) {
  const clip = p.clips.find((c) => c.id === clipId)
  const [tab, setTab] = useState<Tab>('adjust')
  if (!clip) return null
  const set = (patch: Partial<MediaClip> | Partial<TextClip>, key?: string) => apply((pp) => updateClip(pp, clip.id, patch), key ? `${clip.id}:${key}` : undefined)

  if (!isMedia(clip)) return <TextInspector clip={clip} set={set} />

  const asset = p.assets.find((a) => a.id === clip.assetId)
  const isAudio = asset?.kind === 'audio' || p.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio'
  const hasSound = isAudio || (asset?.kind === 'video' && asset.hasAudio !== false)
  const tabs: [Tab, string][] = isAudio
    ? [['audio', 'Audio']]
    : [
        ['adjust', 'Color'],
        ['look', 'Looks'],
        ['transition', 'Transition'],
        ...(asset?.kind === 'video' ? ([['objects', 'Objects']] as [Tab, string][]) : []),
        ['layout', 'Layout'],
        ...(hasSound ? ([['audio', 'Audio']] as [Tab, string][]) : []),
      ]
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0]
  const hasPrev = !!previousClip(p, clip)

  return (
    <div className="ins">
      <div className="ins-title">
        <strong>{asset?.name ?? 'Clip'}</strong>
        <span className="muted small">
          {formatDuration(clip.start * 1000)} · {formatDuration(clip.duration * 1000)} long
        </span>
      </div>
      <div className="ins-tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={current === t} className={current === t ? 'ins-tab-on' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {current === 'adjust' && (
        <Section title="Color" action={<button type="button" className="link-btn" onClick={() => set({ color: { ...neutralColor } })}>Reset</button>}>
          {COLOR_SLIDERS.map((s) => (
            <Range key={s.key} label={s.label} min={s.min} max={s.max} step={s.step} value={clip.color[s.key]} onChange={(v) => set({ color: { ...clip.color, [s.key]: v } }, `color-${s.key}`)} format={s.key === 'hue' ? (v) => `${v}°` : (v) => `${Math.round(v * 100)}`} />
          ))}
        </Section>
      )}

      {current === 'look' && (
        <Section title="Looks & LUTs" action={<button type="button" className="link-btn" onClick={onImportLut}>Import .cube</button>}>
          <div className="look-grid">
            <button type="button" className={`look ${!clip.lut ? 'look-on' : ''}`} onClick={() => set({ lut: null })}>
              <LookPreview lookId={null} />
              None
            </button>
            {LOOKS.map((l) => (
              <button key={l.id} type="button" className={`look ${clip.lut === l.id ? 'look-on' : ''}`} onClick={() => set({ lut: l.id })}>
                <LookPreview lookId={l.id} />
                {l.name}
              </button>
            ))}
            {p.luts.map((l) => (
              <button key={l.id} type="button" className={`look ${clip.lut === l.id ? 'look-on' : ''}`} onClick={() => set({ lut: l.id })} title="Imported LUT">
                <span className="look-sw look-sw-file">.cube</span>
                {l.name}
              </button>
            ))}
          </div>
          {clip.lut && <Range label="Strength" min={0} max={1} step={0.01} value={clip.lutStrength} onChange={(v) => set({ lutStrength: v }, 'lut-strength')} format={(v) => `${Math.round(v * 100)}%`} />}
        </Section>
      )}

      {current === 'transition' && (
        <Section title="Transition in">
          <p className="muted small">{hasPrev ? 'Blends from the clip right before this one.' : 'No clip right before this one, so it enters from an empty frame.'}</p>
          <div className="trans-grid">
            {TRANSITIONS.map((t) => (
              <button key={t.type} type="button" className={`trans ${clip.transitionIn.type === t.type ? 'trans-on' : ''}`} onClick={() => set({ transitionIn: { ...clip.transitionIn, type: t.type } })}>
                <span className={`trans-icon trans-${t.type}`} aria-hidden>
                  <span />
                </span>
                {t.name}
              </button>
            ))}
          </div>
          {clip.transitionIn.type !== 'none' && (
            <Range label="Duration" min={0.2} max={Math.max(0.3, Math.min(3, clip.duration))} step={0.05} value={clip.transitionIn.duration} onChange={(v) => set({ transitionIn: { ...clip.transitionIn, duration: v } }, 'trans-dur')} format={(v) => `${v.toFixed(2)} s`} />
          )}
        </Section>
      )}
      {current === 'transition' && (
        <Section title="Transition out">
          <p className="muted small">How this clip leaves at its end.</p>
          <div className="trans-grid">
            {TRANSITIONS.map((t) => {
              const out = clip.transitionOut ?? { type: 'none' as const, duration: 0.8 }
              return (
                <button key={t.type} type="button" className={`trans ${out.type === t.type ? 'trans-on' : ''}`} onClick={() => set({ transitionOut: { ...out, type: t.type } })}>
                  <span className={`trans-icon trans-${t.type}`} aria-hidden>
                    <span />
                  </span>
                  {t.name}
                </button>
              )
            })}
          </div>
          {clip.transitionOut && clip.transitionOut.type !== 'none' && (
            <Range label="Duration" min={0.2} max={Math.max(0.3, Math.min(3, clip.duration))} step={0.05} value={clip.transitionOut.duration} onChange={(v) => set({ transitionOut: { ...clip.transitionOut!, duration: v } }, 'trans-out-dur')} format={(v) => `${v.toFixed(2)} s`} />
          )}
        </Section>
      )}

      {current === 'objects' && (
        <Section title="Find & remove objects">
          <p className="muted small">ml5.js looks through this clip and lists the objects it finds. Pick the ones to remove; they're painted out using the background around them.</p>
          {scan?.clipId === clip.id ? (
            <div className="row gap-s">
              <progress value={scan.progress} max={1} aria-label="Scanning for objects" />
              <button type="button" className="btn btn-small btn-ghost" onClick={onCancelScan}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => onScan(clip)} disabled={!!scan}>
              {clip.objects ? 'Scan again' : 'Find objects'}
            </button>
          )}
          {clip.objects && (
            <div className="object-list">
              {clip.objects.labels.length === 0 && <span className="muted small">No objects found.</span>}
              {clip.objects.labels.map(({ label, count }) => {
                const off = clip.objects!.remove.includes(label)
                return (
                  <button
                    key={label}
                    type="button"
                    className={`object-chip ${off ? 'object-chip-off' : ''}`}
                    aria-pressed={off}
                    onClick={() => set({ objects: { ...clip.objects!, remove: off ? clip.objects!.remove.filter((l) => l !== label) : [...clip.objects!.remove, label] } })}
                  >
                    <span className="object-dot" style={{ background: labelColor(label) }} aria-hidden />
                    <span className="object-name">{label}</span>
                    <span className="object-count">{Math.round((count / Math.max(1, clip.objects!.samples.length)) * 100)}%</span>
                    <span className="object-action">{off ? 'Removed' : 'Keep'}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {current === 'layout' && (
        <Section title="Layout">
          <div className="segmented">
            {(['contain', 'cover'] as const).map((f) => (
              <button key={f} type="button" className={clip.fit === f ? 'seg-on' : ''} onClick={() => set({ fit: f })}>
                {f === 'contain' ? 'Fit' : 'Fill'}
              </button>
            ))}
          </div>
          <Range label="Scale" min={0.1} max={3} step={0.01} value={clip.scale} onChange={(v) => set({ scale: v }, 'scale')} format={(v) => `${Math.round(v * 100)}%`} />
          <Range label="Position X" min={-0.5} max={1.5} step={0.005} value={clip.x} onChange={(v) => set({ x: v }, 'x')} format={(v) => `${Math.round(v * 100)}%`} />
          <Range label="Position Y" min={-0.5} max={1.5} step={0.005} value={clip.y} onChange={(v) => set({ y: v }, 'y')} format={(v) => `${Math.round(v * 100)}%`} />
          <Range label="Opacity" min={0} max={1} step={0.01} value={clip.opacity} onChange={(v) => set({ opacity: v }, 'opacity')} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="row wrap gap-s">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => set({ scale: 0.32, x: 0.8, y: 0.78 })}>
              Picture-in-picture
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => set({ scale: 1, x: 0.5, y: 0.5, opacity: 1 })}>
              Reset
            </button>
          </div>
          <p className="muted small">Tip: drag on the preview to move the selected clip.</p>
        </Section>
      )}

      {current === 'audio' && (
        <Section title="Audio">
          <label className="toggle toggle-compact">
            <input type="checkbox" role="switch" checked={clip.muted} onChange={(e) => set({ muted: e.target.checked })} />
            <span className="switch" aria-hidden />
            <span className="toggle-text">
              <span>Mute this clip</span>
            </span>
          </label>
          <Range label="Volume" min={0} max={2} step={0.01} value={clip.volume} onChange={(v) => set({ volume: v }, 'volume')} format={(v) => `${Math.round(v * 100)}%`} />
          <Range label="Fade in" min={0} max={Math.min(5, clip.duration / 2)} step={0.05} value={clip.fadeIn} onChange={(v) => set({ fadeIn: v }, 'fade-in')} format={(v) => `${v.toFixed(1)} s`} />
          <Range label="Fade out" min={0} max={Math.min(5, clip.duration / 2)} step={0.05} value={clip.fadeOut} onChange={(v) => set({ fadeOut: v }, 'fade-out')} format={(v) => `${v.toFixed(1)} s`} />
        </Section>
      )}
    </div>
  )
}

function TextInspector({ clip, set }: { clip: TextClip; set: (patch: Partial<TextClip>, key?: string) => void }) {
  return (
    <div className="ins">
      <div className="ins-title">
        <strong>Text</strong>
        <span className="muted small">
          {formatDuration(clip.start * 1000)} · {formatDuration(clip.duration * 1000)} long
        </span>
      </div>
      <Section title="Words">
        <textarea className="ins-text" rows={3} value={clip.text} onChange={(e) => set({ text: e.target.value }, 'text')} aria-label="Text" />
        {(clip.style === 'lower-third' || clip.style === 'quote') && <input value={clip.subtitle} onChange={(e) => set({ subtitle: e.target.value }, 'subtitle')} placeholder="Second line" aria-label="Second line" />}
      </Section>
      <Section title="Design">
        <div className="design-grid">
          {TEXT_DESIGNS.map((d) => (
            <button key={d.id} type="button" className={`design design-${d.id} ${clip.style === d.id ? 'design-on' : ''}`} onClick={() => set({ style: d.id, color: d.preset.color ?? clip.color, accent: d.preset.accent ?? clip.accent, font: d.preset.font ?? clip.font })}>
              <TextPreview designId={d.id} />
              <span className="design-name">{d.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Style">
        <label className="field">
          <span className="label">Font</span>
          <select value={clip.font} onChange={(e) => set({ font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row gap-s">
          <label className="ins-color">
            <input type="color" value={clip.color} onChange={(e) => set({ color: e.target.value }, 'color')} />
            Text
          </label>
          <label className="ins-color">
            <input type="color" value={clip.accent} onChange={(e) => set({ accent: e.target.value }, 'accent')} />
            Accent
          </label>
          <div className="segmented" role="radiogroup" aria-label="Alignment">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={clip.align === a} className={clip.align === a ? 'seg-on' : ''} onClick={() => set({ align: a })}>
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {BOXED_DESIGNS.includes(clip.style) && (
          <>
            <Range label="Background" min={0} max={1} step={0.01} value={clip.bgOpacity ?? DEFAULT_BG_OPACITY} onChange={(v) => set({ bgOpacity: v }, 'bg-opacity')} format={(v) => `${Math.round(v * 100)}%`} />
            <label className="toggle toggle-compact">
              <input type="checkbox" role="switch" checked={clip.frosted ?? true} onChange={(e) => set({ frosted: e.target.checked })} />
              <span className="switch" aria-hidden />
              <span className="toggle-text">
                <span>Frosted glass (blur the video behind)</span>
              </span>
            </label>
          </>
        )}
        <Range label="Size" min={0.02} max={0.35} step={0.005} value={clip.size} onChange={(v) => set({ size: v }, 'size')} format={(v) => `${Math.round(v * 100)}`} />
        <Range label="Position X" min={0} max={1} step={0.005} value={clip.x} onChange={(v) => set({ x: v }, 'x')} format={(v) => `${Math.round(v * 100)}%`} />
        <Range label="Position Y" min={0} max={1} step={0.005} value={clip.y} onChange={(v) => set({ y: v }, 'y')} format={(v) => `${Math.round(v * 100)}%`} />
      </Section>
      <Section title="Animation">
        <div className="row gap-s">
          <label className="field grow">
            <span className="label">In</span>
            <select value={clip.animIn} onChange={(e) => set({ animIn: e.target.value as TextClip['animIn'] })}>
              {TEXT_ANIMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span className="label">Out</span>
            <select value={clip.animOut} onChange={(e) => set({ animOut: e.target.value as TextClip['animOut'] })}>
              {TEXT_ANIMS.filter((a) => a.value !== 'typewriter').map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Range label="Speed" min={0.1} max={2} step={0.05} value={clip.animDuration} onChange={(v) => set({ animDuration: v }, 'anim')} format={(v) => `${v.toFixed(2)} s`} />
      </Section>
    </div>
  )
}
