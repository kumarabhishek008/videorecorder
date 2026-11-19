# Studio Recorder — browser screen recorder

A local-first screen, camera and audio recorder that runs entirely in the browser — no login, no uploads.
Recordings stay on your computer: in the in-browser library (IndexedDB) and/or saved to any folder on your drives.

Built with **Next.js** (App Router). The recorder and editor run in the browser; server code lives in
`src/app/api/` (for example `GET /api/health`), so both ship in one app and one Docker image.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build (.next/standalone)
npm start          # serve the build on $PORT (default 3000)
npm run typecheck
```

Screen capture needs a secure context: `localhost` works for development; deploy behind HTTPS (Cloud Run gives you HTTPS).

`.npmrc` turns off install scripts, because ml5's postinstall (patch-package) fails outside ml5's own repo.
`npm run dev/build` copy the MediaPipe engine files into `public/mediapipe`.

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
change its size, zoom with a click, and pause, mute or finish without coming back to the Studio Recorder tab.

**Click effects** — click the preview (or the mini-window) and the recording smoothly **zooms** in or out there, shows a
**spotlight**, or just a **highlight** ripple; it eases back out after a few seconds or on `Esc`. Zoom level 0.5×–3×: below 1× the picture shrinks towards the click, with a dark backdrop around it.
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

**Camera background** — blur (light/medium/strong) or replace it with a preset or your own uploaded picture
(MediaPipe selfie segmentation, runs on your computer).

**Find & remove objects** (ml5.js, COCO-SSD) — one toggle; the Studio lists what the camera sees and you tap an
object to remove it from the live video, or tap again to keep it.

**Video editor**
- Multiple video, audio and text tracks; drag to move, trim the ends, snap, split at the playhead, detach audio, ripple delete, undo/redo.
- Colour controls (exposure, contrast, saturation, temperature, tint, hue, vignette, fade, grain, sharpen),
  12 built-in looks and your own `.cube` LUTs, each shown as a live preview.
- Transitions between clips: fades, zoom in/out, slide and push, wipes, circle, spin, blur.
- Designed text (titles, lower thirds, neon, captions, quotes and more) with in/out animations. Boxed designs have a
  see-through, frosted-glass background with an opacity slider, so the video stays visible behind them.
- Object removal on a clip: scan it with ml5.js, then pick which objects to remove.
- **Export & download** renders the edit and downloads it at once; a copy goes to your library too.

**Look** — light, frosted-glass theme taken from a macOS wallpaper: sky and deep blue, teal, sand and slate, with
compact controls and icons from [Lucide](https://lucide.dev).

## Docker

```bash
docker build -t studio-recorder .
docker run --rm -p 8080:8080 studio-recorder   # http://localhost:8080
```

The image is a multi-stage Node 22 Alpine build of Next's standalone output, runs as a non-root user and listens on `$PORT` (8080 by default).

## Google Cloud Run

From this folder, with the [gcloud CLI](https://cloud.google.com/sdk/docs/install) signed in:

```bash
gcloud run deploy studio-recorder --source . --region us-central1 --allow-unauthenticated
```

`--source .` builds the Dockerfile with Cloud Build and deploys it; Cloud Run serves it over HTTPS, which screen
capture needs. To build the image yourself instead, push it to Artifact Registry and deploy that image:

```bash
gcloud artifacts repositories create apps --repository-format=docker --location=us-central1
gcloud builds submit --tag us-central1-docker.pkg.dev/PROJECT_ID/apps/studio-recorder
gcloud run deploy studio-recorder --image us-central1-docker.pkg.dev/PROJECT_ID/apps/studio-recorder --region us-central1 --allow-unauthenticated
```

Recordings never leave the browser, so the server needs no storage or database; a health check is at `/api/health`.

**Cameras** — set Camera zoom (0.5×, 0.75× or 1×, default 0.75×) to fit more of the picture in the frame, with a dark backdrop around it. On a phone or tablet, switch between the front and back camera, even mid-recording (the back camera is never mirrored). On a computer, use the default camera or pick one from the list. Phones can't share their screen from a browser, so they offer Camera and Audio modes.

**Player** — custom controls with click-to-seek timeline, 5-second skip, frame stepping, speed, volume, picture-in-picture and fullscreen. Keys: `Space` play · `←`/`→` 5s · `,`/`.` frame · `↑`/`↓` volume · `M` mute · `F` fullscreen.

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
