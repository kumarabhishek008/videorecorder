// 3D LUTs: built-in looks (generated) and imported .cube files.
// A LUT is stored as RGBA bytes laid out as N slices side by side: width N*N, height N.

export interface LutData {
  size: number
  data: Uint8Array
}

type RGB = [number, number, number]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const sCurve = (v: number, k: number) => {
  // Smooth contrast around mid grey; k=0 none, k=1 strong.
  const c = v - 0.5
  return clamp01(0.5 + c * (1 + k) - 4 * k * c * c * c)
}
const sat = (c: RGB, amount: number): RGB => {
  const l = luma(c)
  return [l + (c[0] - l) * amount, l + (c[1] - l) * amount, l + (c[2] - l) * amount]
}
/** Tints shadows toward one color and highlights toward another. */
const splitTone = (c: RGB, shadow: RGB, high: RGB, amount: number): RGB => {
  const l = luma(c)
  const ws = (1 - l) * amount
  const wh = l * amount
  return [c[0] + (shadow[0] - 0.5) * ws + (high[0] - 0.5) * wh, c[1] + (shadow[1] - 0.5) * ws + (high[1] - 0.5) * wh, c[2] + (shadow[2] - 0.5) * ws + (high[2] - 0.5) * wh]
}
const lift = (c: RGB, amount: number): RGB => [mix(amount, 1, c[0]), mix(amount, 1, c[1]), mix(amount, 1, c[2])]

export interface Look {
  id: string
  name: string
  fn: (c: RGB) => RGB
}

export const LOOKS: Look[] = [
  { id: 'look:cinematic', name: 'Cinematic', fn: (c) => splitTone(sat(c.map((v) => sCurve(v, 0.35)) as RGB, 0.85), [0.3, 0.55, 0.62], [0.68, 0.55, 0.4], 0.35) },
  { id: 'look:teal-orange', name: 'Teal & Orange', fn: (c) => splitTone(sat(c, 1.1), [0.2, 0.55, 0.65], [0.78, 0.55, 0.32], 0.55) },
  { id: 'look:warm-film', name: 'Warm film', fn: (c) => lift(splitTone(c.map((v) => sCurve(v, 0.2)) as RGB, [0.55, 0.45, 0.4], [0.65, 0.55, 0.4], 0.3), 0.05) },
  { id: 'look:cool-blue', name: 'Cool blue', fn: (c) => splitTone(sat(c, 0.9), [0.35, 0.45, 0.7], [0.45, 0.52, 0.62], 0.4) },
  { id: 'look:vintage', name: 'Vintage', fn: (c) => lift(splitTone(sat(c, 0.6), [0.45, 0.4, 0.55], [0.7, 0.6, 0.4], 0.4), 0.1) },
  { id: 'look:bleach', name: 'Bleach bypass', fn: (c) => sat(c.map((v) => sCurve(v, 0.6)) as RGB, 0.45) },
  { id: 'look:noir', name: 'Noir B&W', fn: (c) => { const l = sCurve(luma(c), 0.7); return [l, l, l] } },
  { id: 'look:sepia', name: 'Sepia', fn: (c) => { const l = luma(c); return [clamp01(l * 1.07 + 0.08), clamp01(l * 0.95 + 0.04), clamp01(l * 0.78)] } },
  { id: 'look:moody', name: 'Moody green', fn: (c) => splitTone(sat(c.map((v) => sCurve(v, 0.3)) as RGB, 0.7), [0.4, 0.58, 0.45], [0.6, 0.58, 0.48], 0.4) },
  { id: 'look:pastel', name: 'Pastel', fn: (c) => lift(sat(c.map((v) => sCurve(v, -0.25)) as RGB, 0.8), 0.12) },
  { id: 'look:vivid', name: 'Vivid', fn: (c) => sat(c.map((v) => sCurve(v, 0.25)) as RGB, 1.4) },
  { id: 'look:sunset', name: 'Sunset', fn: (c) => splitTone(sat(c, 1.1), [0.55, 0.38, 0.6], [0.78, 0.5, 0.35], 0.45) },
]

const cache = new Map<string, LutData>()

function fromFunction(fn: (c: RGB) => RGB, size = 25): LutData {
  const data = new Uint8Array(size * size * size * 4)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = fn([r / (size - 1), g / (size - 1), b / (size - 1)])
        const i = (g * size * size + b * size + r) * 4
        data[i] = Math.round(clamp01(out[0]) * 255)
        data[i + 1] = Math.round(clamp01(out[1]) * 255)
        data[i + 2] = Math.round(clamp01(out[2]) * 255)
        data[i + 3] = 255
      }
  return { size, data }
}

export function lookLut(id: string): LutData | null {
  const hit = cache.get(id)
  if (hit) return hit
  const look = LOOKS.find((l) => l.id === id)
  if (!look) return null
  const lut = fromFunction(look.fn)
  cache.set(id, lut)
  return lut
}

export function registerLut(id: string, lut: LutData) {
  cache.set(id, lut)
}

export function getLut(id: string | null): LutData | null {
  if (!id) return null
  return cache.get(id) ?? lookLut(id)
}

/** Reads an Adobe/Resolve .cube 3D LUT. Throws with a readable message if the file isn't one. */
export function parseCube(text: string): LutData {
  let size = 0
  const values: number[] = []
  let domainMin: RGB = [0, 0, 0]
  let domainMax: RGB = [1, 1, 1]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const key = parts[0].toUpperCase()
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10)
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported; use a 3D .cube file.')
    else if (key === 'DOMAIN_MIN') domainMin = parts.slice(1, 4).map(Number) as RGB
    else if (key === 'DOMAIN_MAX') domainMax = parts.slice(1, 4).map(Number) as RGB
    else if (/^[-+.\d]/.test(key) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]))
  }
  if (!size || size < 2 || size > 128) throw new Error('This file has no LUT_3D_SIZE line, so it is not a 3D .cube LUT.')
  if (values.length < size * size * size * 3) throw new Error('This .cube file is incomplete.')
  const data = new Uint8Array(size * size * size * 4)
  const norm = (v: number, k: number) => clamp01((v - domainMin[k]) / (domainMax[k] - domainMin[k] || 1))
  // .cube order: red changes fastest, then green, then blue.
  let n = 0
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const i = (g * size * size + b * size + r) * 4
        data[i] = Math.round(norm(values[n++], 0) * 255)
        data[i + 1] = Math.round(norm(values[n++], 1) * 255)
        data[i + 2] = Math.round(norm(values[n++], 2) * 255)
        data[i + 3] = 255
      }
  return { size, data }
}

/** Applies a look to an RGB triple in 0..1; used for small swatches in the UI. */
export function previewLook(id: string, c: RGB): RGB {
  const look = LOOKS.find((l) => l.id === id)
  return look ? look.fn(c) : c
}
