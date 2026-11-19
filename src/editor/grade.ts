// GPU color grading for editor clips: exposure, contrast, color, LUT, vignette, grain, sharpen.
import type { LutData } from './luts'
import type { ColorAdjust } from './types'

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform sampler2D u_lut;
uniform float u_lutSize;
uniform float u_lutAmt;
uniform vec2 u_texel;
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_temp, u_tint, u_hue, u_vignette, u_fade, u_grain, u_sharpen, u_time;

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 sampleSlice(float b, vec2 rg) {
  float n = u_lutSize;
  vec2 uv = vec2((b * n + rg.x * (n - 1.0) + 0.5) / (n * n), (rg.y * (n - 1.0) + 0.5) / n);
  return texture2D(u_lut, uv).rgb;
}

vec3 applyLut(vec3 c) {
  float b = c.b * (u_lutSize - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, u_lutSize - 1.0);
  return mix(sampleSlice(b0, c.rg), sampleSlice(b1, c.rg), b - b0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 src = texture2D(u_img, v_uv);
  vec3 c = src.rgb;
  if (u_sharpen > 0.0) {
    vec3 n = texture2D(u_img, v_uv + vec2(u_texel.x, 0.0)).rgb + texture2D(u_img, v_uv - vec2(u_texel.x, 0.0)).rgb
           + texture2D(u_img, v_uv + vec2(0.0, u_texel.y)).rgb + texture2D(u_img, v_uv - vec2(0.0, u_texel.y)).rgb;
    c += (c - n * 0.25) * u_sharpen * 2.0;
  }
  c *= exp2(u_exposure);
  c += u_brightness * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c.r += u_temp * 0.08;
  c.b -= u_temp * 0.08;
  c.g -= u_tint * 0.06;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + u_saturation);
  if (u_hue != 0.0) c = hueShift(c, u_hue);
  c = clamp(c, 0.0, 1.0);
  if (u_lutAmt > 0.0) c = mix(c, applyLut(c), u_lutAmt);
  c = u_fade * 0.18 + c * (1.0 - u_fade * 0.18);
  if (u_vignette > 0.0) {
    float d = distance(v_uv, vec2(0.5));
    c *= 1.0 - u_vignette * smoothstep(0.3, 0.85, d);
  }
  if (u_grain > 0.0) c += (hash(v_uv * 1000.0 + u_time) - 0.5) * u_grain * 0.18;
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c * src.a, src.a);
}`

export function isNeutral(c: ColorAdjust): boolean {
  return Object.values(c).every((v) => v === 0)
}

/** One WebGL canvas reused for every clip, every frame. Draw its result right after `render`. */
export class Grader {
  readonly canvas = document.createElement('canvas')
  private gl: WebGLRenderingContext | null
  private prog: WebGLProgram | null = null
  private img: WebGLTexture | null = null
  private lut: WebGLTexture | null = null
  private lutLoaded: LutData | null = null
  private loc: Record<string, WebGLUniformLocation | null> = {}

  constructor() {
    this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true })
    if (this.gl) this.setup(this.gl)
  }

  get available() {
    return !!this.gl && !!this.prog
  }

  private setup(gl: WebGLRenderingContext) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    this.prog = prog
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
    for (const n of ['u_img', 'u_lut', 'u_lutSize', 'u_lutAmt', 'u_texel', 'u_exposure', 'u_brightness', 'u_contrast', 'u_saturation', 'u_temp', 'u_tint', 'u_hue', 'u_vignette', 'u_fade', 'u_grain', 'u_sharpen', 'u_time'])
      this.loc[n] = gl.getUniformLocation(prog, n)
    const tex = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return t
    }
    this.img = tex()
    this.lut = tex()
    gl.uniform1i(this.loc.u_img, 0)
    gl.uniform1i(this.loc.u_lut, 1)
  }

  /** Grades `src` into this.canvas at w×h. Returns false if WebGL isn't available or the frame isn't ready. */
  render(src: TexImageSource, w: number, h: number, c: ColorAdjust, lut: LutData | null, lutAmt: number): boolean {
    const gl = this.gl
    if (!gl || !this.prog) return false
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.img)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    } catch {
      return false
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.lut)
    if (lut && lut !== this.lutLoaded) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data)
      this.lutLoaded = lut
    }
    const L = this.loc
    gl.uniform1f(L.u_lutSize, lut?.size ?? 2)
    gl.uniform1f(L.u_lutAmt, lut ? lutAmt : 0)
    const sw = (src as HTMLVideoElement).videoWidth || (src as { width: number }).width || w
    const shh = (src as HTMLVideoElement).videoHeight || (src as { height: number }).height || h
    gl.uniform2f(L.u_texel, 1 / sw, 1 / shh)
    gl.uniform1f(L.u_exposure, c.exposure)
    gl.uniform1f(L.u_brightness, c.brightness)
    gl.uniform1f(L.u_contrast, c.contrast)
    gl.uniform1f(L.u_saturation, c.saturation)
    gl.uniform1f(L.u_temp, c.temperature)
    gl.uniform1f(L.u_tint, c.tint)
    gl.uniform1f(L.u_hue, (c.hue * Math.PI) / 180)
    gl.uniform1f(L.u_vignette, c.vignette)
    gl.uniform1f(L.u_fade, c.fade)
    gl.uniform1f(L.u_grain, c.grain)
    gl.uniform1f(L.u_sharpen, c.sharpen)
    gl.uniform1f(L.u_time, (performance.now() / 1000) % 100)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }
}
