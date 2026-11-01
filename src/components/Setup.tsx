import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MediaSources } from '../hooks/useMediaSources'
import { LevelMeter } from '../lib/audio'
import { canPickFolders } from '../lib/files'
import { supportedFormats } from '../lib/recorder'
import { clickEffectLabels, modeLabels, usesCamera, usesScreen, type ClickEffect, type Mode, type Settings } from '../lib/settings'
import { IconCamera, IconFolder, IconMic, IconMicOff, IconScreen, IconScreenCam, IconWave, IconZoom } from './Icons'
import { LevelBar } from './LevelBar'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => void
  resetSettings: () => void
  sources: MediaSources
  starting: boolean
  error: string | null
  onStart: () => void
  folderName: string | null
  onPickFolder: () => void
  onClearFolder: () => void
}

const MODES: { mode: Mode; icon: ReactNode; hint: string }[] = [
  { mode: 'screen-camera', icon: <IconScreenCam />, hint: 'Screen with your camera bubble' },
  { mode: 'screen', icon: <IconScreen />, hint: 'Just the screen' },
  { mode: 'camera', icon: <IconCamera />, hint: 'Full-frame camera' },
  { mode: 'audio', icon: <IconWave />, hint: 'Voice or audio only' },
]

const hasDocPip = typeof window !== 'undefined' && !!window.documentPictureInPicture

export function Setup({ settings: s, update, resetSettings, sources, starting, error, onStart, folderName, onPickFolder, onClearFolder }: Props) {
  const formats = useMemo(supportedFormats, [])
  const [advanced, setAdvanced] = useState(false)

  const deviceLabel = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`
  const startLabel = s.mode === 'audio' ? 'Start recording audio' : usesScreen(s.mode) ? 'Choose screen & record' : 'Start recording'
  const missingMic = s.mode === 'audio' && !sources.micStream

  return (
    <div className="setup">
      <section className="panel setup-main" aria-labelledby="setup-title">
        <div className="hero">
          <h1 id="setup-title" className="setup-title">Record your screen, camera &amp; voice</h1>
          <p className="muted">No sign-up, no uploads. Recordings stay on this computer.</p>
        </div>

        <fieldset className="modes">
          <legend className="label">What do you want to record?</legend>
          {MODES.map((m) => (
            <label key={m.mode} className={`mode ${s.mode === m.mode ? 'mode-on' : ''}`}>
              <input type="radio" name="mode" value={m.mode} checked={s.mode === m.mode} onChange={() => update({ mode: m.mode })} />
              <span className="mode-icon">{m.icon}</span>
              <span className="mode-name">{modeLabels[m.mode]}</span>
              <span className="mode-hint">{m.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="sources">
          {usesCamera(s.mode) && (
            <div className="field">
              <label className="label" htmlFor="cam">
                Camera
              </label>
              <select id="cam" value={s.cameraId} onChange={(e) => update({ cameraId: e.target.value })}>
                <option value="">Default camera</option>
                {sources.devices.cameras.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Camera')}
                  </option>
                ))}
              </select>
              {sources.camError && <p className="error-text">{sources.camError}</p>}
            </div>
          )}

          <div className="field">
            <div className="label-row">
              <label className="label" htmlFor="mic">
                Microphone
              </label>
              <button
                type="button"
                className={`chip ${s.micEnabled ? 'chip-on' : ''}`}
                aria-pressed={s.micEnabled}
                onClick={() => update({ micEnabled: !s.micEnabled })}
              >
                {s.micEnabled ? <IconMic width={14} height={14} /> : <IconMicOff width={14} height={14} />}
                {s.micEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <select id="mic" value={s.micId} disabled={!s.micEnabled} onChange={(e) => update({ micId: e.target.value })}>
              <option value="">Default microphone</option>
              {sources.devices.mics.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, i, 'Microphone')}
                </option>
              ))}
            </select>
            {sources.micStream && <MicPreview stream={sources.micStream} />}
            {sources.micError && <p className="error-text">{sources.micError}</p>}
          </div>

          {usesScreen(s.mode) && (
            <Toggle
              label="Record system / tab audio"
              hint="Chrome shares tab audio; full system audio depends on your OS."
              checked={s.systemAudio}
              onChange={(v) => update({ systemAudio: v })}
            />
          )}

          <Toggle
            label="Voice isolation"
            hint="Browser noise suppression + voice EQ, noise gate and compressor."
            checked={s.voiceIsolation}
            onChange={(v) => update({ voiceIsolation: v })}
            disabled={!s.micEnabled}
          />
        </div>

        {(sources.camError || sources.micError) && (
          <button type="button" className="btn btn-ghost" onClick={sources.retry}>
            Retry camera / microphone access
          </button>
        )}

        <button type="button" className="btn btn-record" onClick={onStart} disabled={starting || missingMic}>
          <span className="rec-dot" aria-hidden />
          {starting ? 'Starting…' : startLabel}
        </button>
        {missingMic && <p className="muted small">Turn on a microphone to record audio.</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">
          Everything stays on this computer. Shortcuts while recording: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> pause,{' '}
          <kbd>S</kbd> finish, <kbd>M</kbd> mute, <kbd>C</kbd> camera, <kbd>D</kbd> draw.
        </p>
      </section>

      <aside className="setup-side">
        {usesCamera(s.mode) && (
          <section className="panel" aria-label="Camera preview">
            <CameraPreview stream={sources.camStream} mirror={s.mirrorCamera} shape={s.mode === 'camera' ? 'wide' : s.bubbleShape} />
            <div className="row wrap gap-s">
              <Toggle label="Mirror" checked={s.mirrorCamera} onChange={(v) => update({ mirrorCamera: v })} compact />
              {sources.blurSupported && <Toggle label="Blur background" checked={s.backgroundBlur} onChange={(v) => update({ backgroundBlur: v })} compact />}
            </div>
            {s.mode === 'screen-camera' && (
              <>
                <Segmented
                  label="Bubble shape"
                  value={s.bubbleShape}
                  options={[
                    ['circle', 'Circle'],
                    ['rounded', 'Rounded'],
                    ['square', 'Square'],
                  ]}
                  onChange={(v) => update({ bubbleShape: v })}
                />
                <Toggle
                  label="Floating camera window"
                  hint={
                    hasDocPip
                      ? 'While recording, only a small resizable camera box floats on top of your apps. Move it anywhere and drag its edges to resize.'
                      : 'Needs Chrome or Edge. Otherwise move the bubble on the preview in this tab.'
                  }
                  checked={s.miniWindow && hasDocPip}
                  onChange={(v) => update({ miniWindow: v })}
                  disabled={!hasDocPip}
                />
              </>
            )}
          </section>
        )}

        {usesScreen(s.mode) && (
          <section className="panel" aria-labelledby="effects-title">
            <h2 id="effects-title" className="panel-title">
              <IconZoom /> Click effects
            </h2>
            <Segmented
              label="When you click the preview"
              value={s.clickEffect}
              options={(Object.keys(clickEffectLabels) as ClickEffect[]).map((k) => [k, clickEffectLabels[k]])}
              onChange={(v) => update({ clickEffect: v })}
            />
            {s.clickEffect === 'zoom' && (
              <Segmented
                label="Zoom level"
                value={String(s.zoomLevel)}
                options={[
                  ['1.5', '1.5×'],
                  ['2', '2×'],
                  ['2.5', '2.5×'],
                  ['3', '3×'],
                ]}
                onChange={(v) => update({ zoomLevel: Number(v) })}
              />
            )}
            {s.mode === 'screen' && (
              <Toggle
                label="Floating controls while recording"
                hint={hasDocPip ? 'A small always-on-top bar with the timer, pause, mute and finish.' : 'Needs Chrome or Edge.'}
                checked={s.miniWindow && hasDocPip}
                onChange={(v) => update({ miniWindow: v })}
                disabled={!hasDocPip}
              />
            )}
            <p className="muted small note">
              Browsers can’t see clicks inside other apps, so effects trigger when you click the preview in the Reel tab. They ease out after a few seconds or on <kbd>Esc</kbd>.
            </p>
          </section>
        )}

        <section className="panel">
          <button type="button" className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            Recording settings <span aria-hidden>{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div className="settings-grid">
              {s.mode !== 'audio' && (
                <>
                  <SelectField
                    label="Resolution"
                    value={s.resolution}
                    onChange={(v) => update({ resolution: v as Settings['resolution'] })}
                    options={[
                      ['source', 'Source (native)'],
                      ['2160', '4K (2160p)'],
                      ['1440', '1440p'],
                      ['1080', '1080p'],
                      ['720', '720p'],
                    ]}
                  />
                  <SelectField
                    label="Frame rate"
                    value={String(s.fps)}
                    onChange={(v) => update({ fps: Number(v) })}
                    options={[
                      ['24', '24 fps'],
                      ['30', '30 fps'],
                      ['60', '60 fps'],
                    ]}
                  />
                  <SelectField
                    label="Quality"
                    value={s.quality}
                    onChange={(v) => update({ quality: v as Settings['quality'] })}
                    options={[
                      ['low', 'Small file'],
                      ['standard', 'Standard'],
                      ['high', 'High'],
                      ['max', 'Maximum'],
                    ]}
                  />
                </>
              )}
              <SelectField
                label="Format"
                value={s.format}
                onChange={(v) => update({ format: v as Settings['format'] })}
                options={[
                  ['webm', `WebM${formats.webm ? '' : ' (unsupported)'}`],
                  ['mp4', `MP4${formats.mp4 ? '' : ' (unsupported)'}`],
                ]}
              />
              <SelectField
                label="Countdown"
                value={String(s.countdown)}
                onChange={(v) => update({ countdown: Number(v) })}
                options={[
                  ['0', 'None'],
                  ['3', '3 seconds'],
                  ['5', '5 seconds'],
                  ['10', '10 seconds'],
                ]}
              />
              {usesScreen(s.mode) && (
                <SelectField
                  label="Mouse cursor"
                  value={s.cursor}
                  onChange={(v) => update({ cursor: v as Settings['cursor'] })}
                  options={[
                    ['always', 'Always show'],
                    ['motion', 'Show when moving'],
                    ['never', 'Hide'],
                  ]}
                />
              )}
              {usesCamera(s.mode) && (
                <SelectField
                  label="Camera quality"
                  value={s.cameraResolution}
                  onChange={(v) => update({ cameraResolution: v as Settings['cameraResolution'] })}
                  options={[
                    ['720', '720p'],
                    ['1080', '1080p'],
                  ]}
                />
              )}

              <div className="settings-span">
                <h3 className="subhead">Audio</h3>
                <Toggle label="Noise gate" hint="Silences background hiss between words." checked={s.noiseGate} onChange={(v) => update({ noiseGate: v })} />
                <Toggle label="Echo cancellation" checked={s.echoCancellation} onChange={(v) => update({ echoCancellation: v })} />
                <Toggle label="Automatic gain" checked={s.autoGain} onChange={(v) => update({ autoGain: v })} />
                <Slider label="Mic volume" value={s.micGain} min={0} max={2} onChange={(v) => update({ micGain: v })} />
                {usesScreen(s.mode) && <Slider label="System audio volume" value={s.systemGain} min={0} max={2} onChange={(v) => update({ systemGain: v })} />}
              </div>

              <div className="settings-span">
                <h3 className="subhead">Saving</h3>
                <Toggle
                  label="Keep recordings in the browser library"
                  hint="Stored locally in this browser so you can replay them later."
                  checked={s.keepInLibrary}
                  onChange={(v) => update({ keepInLibrary: v })}
                />
                {canPickFolders ? (
                  <>
                    <div className="folder-row">
                      <IconFolder />
                      <span className="folder-name">{folderName ?? 'No folder chosen'}</span>
                      <button type="button" className="btn btn-small" onClick={onPickFolder}>
                        {folderName ? 'Change' : 'Choose folder'}
                      </button>
                      {folderName && (
                        <button type="button" className="btn btn-small btn-ghost" onClick={onClearFolder}>
                          Clear
                        </button>
                      )}
                    </div>
                    <Toggle
                      label="Auto-save each recording to this folder"
                      checked={s.autoSaveToFolder}
                      onChange={(v) => update({ autoSaveToFolder: v })}
                      disabled={!folderName}
                    />
                    <Toggle
                      label="Write to disk while recording"
                      hint="Best for very long recordings: data goes straight to the folder instead of memory."
                      checked={s.recordToDisk}
                      onChange={(v) => update({ recordToDisk: v })}
                      disabled={!folderName}
                    />
                  </>
                ) : (
                  <p className="muted small">Your browser will download recordings to its download folder. Chrome or Edge can save straight to a folder you choose.</p>
                )}
              </div>
              <button type="button" className="btn btn-ghost btn-small settings-span" onClick={resetSettings}>
                Reset all settings
              </button>
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}

function CameraPreview({ stream, mirror, shape }: { stream: MediaStream | null; mirror: boolean; shape: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return (
    <div className={`cam-preview cam-${shape}`}>
      {stream ? <video ref={ref} autoPlay muted playsInline style={{ transform: mirror ? 'scaleX(-1)' : undefined }} aria-label="Camera preview" /> : <span className="muted small">Waiting for camera…</span>}
    </div>
  )
}

function MicPreview({ stream }: { stream: MediaStream }) {
  const meter = useRef<LevelMeter | null>(null)
  useEffect(() => {
    const m = new LevelMeter(stream)
    meter.current = m
    return () => {
      m.close()
      meter.current = null
    }
  }, [stream])
  const get = useCallback(() => meter.current?.level() ?? 0, [])
  return <LevelBar getLevel={get} label="Microphone level" />
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  compact,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <label className={`toggle ${compact ? 'toggle-compact' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </span>
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="label-row">
        <span className="label">{label}</span>
        <span className="muted small">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={min} max={max} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'seg-on' : ''} disabled={disabled} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
