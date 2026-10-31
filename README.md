# Reel — browser screen recorder

A local-first screen, camera and audio recorder that runs entirely in the browser — no login, no uploads.
Recordings stay on your computer: in the in-browser library (IndexedDB) and/or saved to any folder on your drives.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
```

Screen capture needs a secure context: `localhost` works for development; deploy behind HTTPS.

## Features

**Recording modes** — Screen + Camera, Screen only, Camera only, Audio only.

**Camera bubble (Loom-style)**
- Drawn into the video; drag to move it, **click to cycle sizes** (S → M → L), drag the corner handle to resize freely.
- Circle, rounded or square shape; mirror toggle; keyboard control (arrows move, `+`/`-` resize, Enter cycles size).
- *Floating window* mode (Chrome/Edge): the camera lives in an always-on-top, OS-resizable window over every app,
  like Loom's desktop bubble. It appears in the video when you share your entire screen.
- Platform background blur when the camera driver supports it.

**Audio**
- Microphone + system/tab audio mixed into one track, with separate volume controls and live level meters.
- **Voice isolation**: browser noise suppression (plus the `voiceIsolation` constraint where supported), then a
  Web Audio chain — high-pass rumble filter, hiss low-pass, de-mud and presence EQ, noise gate (AudioWorklet)
  and a compressor with make-up gain.
- Echo cancellation and automatic gain toggles; mute/unmute while recording.

**Floating mini-window** (Chrome/Edge, on by default) — opens when you start recording a screen and stays on top
of every app: it shows the live recording with your face, lets you drag the camera bubble left/right/anywhere,
change its size, zoom with a click, and pause, mute or finish without coming back to the Reel tab.

**Click effects** — click the preview (or the mini-window) and the recording smoothly **zooms in** there, shows a
**spotlight**, or just a **highlight** ripple; it eases back out after a few seconds or on `Esc`. Zoom level 1.5×–3×.
Browsers don’t expose clicks made inside other apps, so effects follow clicks on the preview, not on the captured app.

**While recording**
- Unlimited length — record until you click **Finish** (or stop sharing from the browser bar).
- Countdown (0/3/5/10 s) with *Start now*, pause/resume, restart, discard.
- Draw on the video with a pen (5 colours); strokes fade out automatically.
- Floating always-on-top controls window (Document Picture-in-Picture) with timer, pause, mute, camera, finish.
- Keeps recording at full frame rate when you switch tabs (compositor runs off a Worker timer).
- Shortcuts: `Alt+Shift+P` pause · `S` finish · `M` mute · `C` camera · `D` draw.

**After recording**
- Instant playback with speed control (0.5×–2×) and picture-in-picture; seekable WebM (duration header is fixed up).
- Save to computer (native *Save as…* dialog), save to a chosen folder, or plain download.
- Trim to a range (creates a new copy; original kept). Save any frame as PNG.
- Library with thumbnails, search, rename, download and delete, plus browser storage usage.

**Output options** — WebM (VP9/VP8 + Opus) or MP4 (H.264) where the browser supports it; resolution up to 4K or
native; 24/30/60 fps; four quality presets; cursor always/when moving/hidden.

**Saving to disk** (Chrome/Edge) — pick a folder once, then optionally auto-save every recording there, or
*write to disk while recording*, which streams data straight into the file so multi-hour recordings don't sit in memory.

**Look** — light theme with a light-blue accent by default; dark theme toggle in the header.

## Browser support

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Screen + camera + mic | ✅ | ✅ | ✅ |
| Tab / system audio | ✅ (tab everywhere; system audio on Windows, ChromeOS, recent macOS) | ❌ | ❌ |
| Floating camera / controls window | ✅ | ❌ | ❌ |
| Save to folder / record to disk | ✅ | download | download |

## Structure

```
src/
  lib/compositor.ts   canvas compositing: screen + camera bubble + annotations, Worker-driven
  lib/audio.ts        mixer, voice-isolation chain, noise-gate worklet, level meters
  lib/recorder.ts     MediaRecorder wrapper: formats, bitrates, pause timing, stream-to-file
  lib/storage.ts      IndexedDB library (metadata, media, folder handles)
  lib/files.ts        Save-as, folder picking and writing
  lib/trim.ts         range export via re-recording
  components/         Setup, Studio (recording), Review (playback), Library, BubbleOverlay, Pip
```
