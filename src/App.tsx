import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { openPipWindow } from './components/Pip'
import { Review } from './components/Review'
import { Setup } from './components/Setup'
import { IconFullscreen, IconFullscreenExit, IconLibrary, IconScreenCam } from './components/Icons'
import { pipSize, Studio, type FinishedRecording } from './components/Studio'
import { useMediaSources } from './hooks/useMediaSources'
import { useSettings } from './hooks/useSettings'
import { useToast } from './hooks/useToast'
import { clearSaveFolder, ensureWriteAccess, getSaveFolder, pickSaveFolder, saveToFolder } from './lib/files'
import { safeFileName } from './lib/format'
import { persistRecording, type OpenRecording } from './lib/library'
import { canCaptureScreen, describeMediaError, getScreen, stopStream } from './lib/media'
import { extensionFor } from './lib/recorder'
import { usesScreen } from './lib/settings'
import { requestPersistentStorage } from './lib/storage'

type View = 'setup' | 'studio' | 'review' | 'library'

interface Session {
  screen: MediaStream | null
  pip: Window | null
}

export function App() {
  const { settings, update, reset } = useSettings()
  const sources = useMediaSources(settings)
  const toast = useToast()
  const [view, setView] = useState<View>('setup')
  const [session, setSession] = useState<Session | null>(null)
  const [current, setCurrent] = useState<OpenRecording | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    getSaveFolder()
      .then((d) => setFolderName(d?.name ?? null))
      .catch(() => {})
    void requestPersistentStorage()
  }, [])

  // Phones can't share their screen from a browser, so start them on the camera.
  useEffect(() => {
    if (!canCaptureScreen && usesScreen(settings.mode)) update({ mode: 'camera' })
  }, [settings.mode, update])

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }

  // Must run straight from the click: screen pickers and floating windows need a user gesture.
  const start = async () => {
    setStartError(null)
    if (usesScreen(settings.mode) && !canCaptureScreen) {
      setStartError('This browser cannot record the screen. Use Chrome, Edge, Firefox or Safari on a desktop computer.')
      return
    }
    setStarting(true)
    let pip: Window | null = null
    try {
      // Open the always-on-top window first (Chrome/Edge): just your camera box (or a small control
      // bar for screen-only), floating over the tab or app being recorded.
      if (usesScreen(settings.mode) && settings.miniWindow) {
        const { width, height } = pipSize(settings.mode === 'screen-camera')
        pip = await openPipWindow(width, height).catch(() => null)
      }
      const screen = usesScreen(settings.mode) ? await getScreen(settings) : null
      setSession({ screen, pip })
      setView('studio')
    } catch (e) {
      pip?.close()
      if ((e as DOMException).name !== 'NotAllowedError' || !usesScreen(settings.mode)) setStartError(describeMediaError(e))
      else setStartError('Screen sharing was cancelled or blocked. On macOS, allow your browser under System Settings → Privacy & Security → Screen Recording.')
    } finally {
      setStarting(false)
    }
  }

  const endSession = useCallback(() => {
    setSession((s) => {
      stopStream(s?.screen)
      s?.pip?.close()
      return null
    })
  }, [])

  const onFinished = async (r: FinishedRecording) => {
    endSession()
    setSaving(true)
    setView('review')
    const ext = extensionFor(r.mimeType)
    if (r.fileHandle) {
      toast(`Saved to your folder as ${r.fileHandle.name}`, 'success')
    } else if (settings.autoSaveToFolder) {
      try {
        const dir = await getSaveFolder()
        if (dir && (await ensureWriteAccess(dir, true))) {
          const saved = await saveToFolder(dir, r.blob, safeFileName(r.name), ext)
          toast(`Auto-saved to ${dir.name}/${saved}`, 'success')
        } else {
          toast('Auto-save needs folder access. Use "Save to folder" below.', 'error')
        }
      } catch (e) {
        toast(`Auto-save failed: ${(e as Error).message}`, 'error')
      }
    }
    try {
      setCurrent(await persistRecording(r, r.name, r.mode, settings.keepInLibrary))
    } catch (e) {
      toast(`Could not add to the library (${(e as Error).message}). Save the file now so it is not lost.`, 'error')
      setCurrent(await persistRecording(r, r.name, r.mode, false))
    } finally {
      setSaving(false)
    }
  }

  const onCancel = useCallback(() => {
    endSession()
    setView('setup')
  }, [endSession])

  const pickFolder = async () => {
    try {
      const dir = await pickSaveFolder()
      if (dir) setFolderName(dir.name)
    } catch (e) {
      toast(`Could not use that folder: ${(e as Error).message}`, 'error')
    }
  }

  const clearFolder = async () => {
    await clearSaveFolder()
    setFolderName(null)
    update({ autoSaveToFolder: false, recordToDisk: false })
  }

  const openRecording = (r: OpenRecording) => {
    setCurrent(r)
    setView('review')
  }

  const recording = view === 'studio'

  return (
    <div className={`app ${recording ? 'app-recording' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span className="brand-dot" />
          </span>
          Studio Recorder
        </div>
        <nav aria-label="Main">
          <button type="button" className={`nav-btn ${view === 'setup' ? 'nav-on' : ''}`} onClick={() => setView('setup')} disabled={recording} aria-current={view === 'setup' ? 'page' : undefined}>
            <IconScreenCam /> Record
          </button>
          <button type="button" className={`nav-btn ${view === 'library' ? 'nav-on' : ''}`} onClick={() => setView('library')} disabled={recording} aria-current={view === 'library' ? 'page' : undefined}>
            <IconLibrary /> Library
          </button>
        </nav>
        {document.fullscreenEnabled ? (
          <button type="button" className="icon-btn topbar-end" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
            {fullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
          </button>
        ) : (
          <span className="topbar-end" />
        )}
      </header>

      <main className="content">
        {view === 'setup' && (
          <Setup
            settings={settings}
            update={update}
            resetSettings={reset}
            sources={sources}
            starting={starting}
            error={startError}
            onStart={() => void start()}
            folderName={folderName}
            onPickFolder={() => void pickFolder()}
            onClearFolder={() => void clearFolder()}
          />
        )}
        {view === 'studio' && session && (
          <Studio
            settings={settings}
            update={update}
            screenStream={session.screen}
            camStream={sources.camStream}
            micStream={sources.micStream}
            canFlip={sources.canFlip}
            initialPip={session.pip}
            onFinished={(r) => void onFinished(r)}
            onCancel={onCancel}
          />
        )}
        {view === 'review' &&
          (saving || !current ? (
            <div className="saving" role="status">
              <div className="spinner" aria-hidden /> Finishing your recording…
            </div>
          ) : (
            <Review
              recording={current}
              settings={settings}
              onNew={() => setView('setup')}
              onLibrary={() => setView('library')}
              onDeleted={() => {
                setCurrent(null)
                setView('library')
              }}
              onOpen={openRecording}
            />
          ))}
        {view === 'library' && <Library onOpen={openRecording} onNew={() => setView('setup')} />}
      </main>
    </div>
  )
}
