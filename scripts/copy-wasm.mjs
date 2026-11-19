// Copies MediaPipe's WebAssembly files into public/ so the browser can load them from this server.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// The package only exports its wasm files, so locate the folder through one of them.
const pkg = dirname(dirname(require.resolve('@mediapipe/tasks-vision/vision_wasm_internal.wasm')))
const out = join(process.cwd(), 'public', 'mediapipe')
mkdirSync(out, { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copyFileSync(join(pkg, 'wasm', f), join(out, f))
console.log('MediaPipe files copied to public/mediapipe')
